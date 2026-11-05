import bcrypt from 'bcryptjs';
import { and, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { COOKIE, publicUser, requireAdmin, requireAuth, setSession } from '../auth';
import { db } from '../db';
import { activityLogs, notifications, projectMembers, projects, tasks, users } from '../db/schema';
import { ApiError, notFound, pageQuery, paged, uuidParam } from '../http';
import { dropUser, Outbox } from '../realtime';

export const core = Router();

/* ---------- auth ---------- */
core.post('/auth/login', async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  if (!user.isActive) throw new ApiError(403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated.');
  setSession(res, user.id);
  res.json({ data: publicUser(user) });
});

core.post('/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.status(204).end();
});

core.use(requireAuth);

core.get('/auth/me', (req, res) => { res.json({ data: publicUser(req.user) }); });

core.patch('/auth/me', async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).max(200).optional(),
  }).parse(req.body);
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (body.name) patch.name = body.name;
  if (body.newPassword) {
    if (!(await bcrypt.compare(body.currentPassword ?? '', req.user.passwordHash))) {
      throw new ApiError(400, 'WRONG_PASSWORD', 'Your current password is incorrect.');
    }
    patch.passwordHash = await bcrypt.hash(body.newPassword, 10);
  }
  const [user] = await db.update(users).set(patch).where(eq(users.id, req.user.id)).returning();
  res.json({ data: publicUser(user) });
});

/* ---------- users ---------- */
const roleEnum = z.enum(['admin', 'project_manager', 'team_member', 'viewer']);

// Directory is needed by Project Managers to add people, so it exposes only basics to non-admins.
core.get('/users', async (req, res) => {
  const q = pageQuery.extend({ search: z.string().optional(), role: roleEnum.optional() }).parse(req.query);
  if (req.user.role !== 'admin' && req.user.role !== 'project_manager') throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to do this.');
  const where = and(
    q.search ? or(ilike(users.name, `%${q.search}%`), ilike(users.email, `%${q.search}%`)) : undefined,
    q.role ? eq(users.role, q.role) : undefined,
    req.user.role === 'admin' ? undefined : eq(users.isActive, true),
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(users).where(where).orderBy(users.name).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(users).where(where),
  ]);
  res.json(paged(rows.map(publicUser), q.page, q.pageSize, total));
});

core.post('/users', requireAdmin, async (req, res) => {
  const body = z.object({
    email: z.string().email().toLowerCase(), name: z.string().trim().min(1).max(100),
    password: z.string().min(8).max(200), role: roleEnum,
  }).parse(req.body);
  const out = new Outbox(req.user);
  const user = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({
      email: body.email, name: body.name, role: body.role, passwordHash: await bcrypt.hash(body.password, 10),
    }).returning();
    await out.activity(tx, { projectId: null, action: 'user.created', entityType: 'user', entityId: u.id, metadata: { name: u.name, role: u.role } });
    return u;
  });
  out.flush();
  res.status(201).json({ data: publicUser(user) });
});

core.get('/users/:id', requireAdmin, async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, uuidParam.parse(req.params.id)));
  if (!user) throw notFound('User');
  res.json({ data: publicUser(user) });
});

core.patch('/users/:id', requireAdmin, async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const body = z.object({ name: z.string().trim().min(1).max(100).optional(), role: roleEnum.optional(), isActive: z.boolean().optional() }).parse(req.body);
  if (id === req.user.id && (body.isActive === false || (body.role && body.role !== 'admin'))) {
    throw new ApiError(400, 'SELF_LOCKOUT', 'You cannot deactivate or demote your own account.');
  }
  const out = new Outbox(req.user);
  const user = await db.transaction(async (tx) => {
    const [u] = await tx.update(users).set({ ...body, updatedAt: new Date() }).where(eq(users.id, id)).returning();
    if (!u) throw notFound('User');
    const action = body.isActive === false ? 'user.deactivated' : 'user.updated';
    await out.activity(tx, { projectId: null, action, entityType: 'user', entityId: id, metadata: { name: u.name, ...body } });
    return u;
  });
  out.flush();
  if (!user.isActive || body.role) dropUser(id); // reconnecting re-evaluates rooms; inactive users cannot reconnect
  res.json({ data: publicUser(user) });
});

/* ---------- notifications ---------- */
core.get('/notifications', async (req, res) => {
  const q = pageQuery.extend({ unread: z.enum(['true', 'false']).optional() }).parse(req.query);
  const where = and(eq(notifications.userId, req.user.id), q.unread === 'true' ? isNull(notifications.readAt) : undefined);
  const [rows, [{ total }], [{ unread }]] = await Promise.all([
    db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(notifications).where(where),
    db.select({ unread: count() }).from(notifications).where(and(eq(notifications.userId, req.user.id), isNull(notifications.readAt))),
  ]);
  res.json({ ...paged(rows, q.page, q.pageSize, total), unread });
});

core.post('/notifications/read-all', async (req, res) => {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, req.user.id), isNull(notifications.readAt)));
  res.status(204).end();
});

core.post('/notifications/:id/read', async (req, res) => {
  const [row] = await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.id, uuidParam.parse(req.params.id)), eq(notifications.userId, req.user.id))).returning();
  if (!row) throw notFound('Notification');
  res.json({ data: row });
});

/* ---------- system activity + dashboard ---------- */
core.get('/activity', requireAdmin, async (req, res) => {
  const q = pageQuery.parse(req.query);
  const [rows, [{ total }]] = await Promise.all([
    db.select({ log: activityLogs, actorName: users.name }).from(activityLogs).leftJoin(users, eq(users.id, activityLogs.userId))
      .orderBy(desc(activityLogs.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(activityLogs),
  ]);
  res.json(paged(rows.map((r) => ({ ...r.log, actorName: r.actorName })), q.page, q.pageSize, total));
});

core.get('/dashboard', async (req, res) => {
  const visible = req.user.role === 'admin'
    ? (await db.select({ id: projects.id }).from(projects).where(ne(projects.status, 'archived'))).map((p) => p.id)
    : (await db.select({ id: projectMembers.projectId }).from(projectMembers).innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(and(eq(projectMembers.userId, req.user.id), ne(projects.status, 'archived')))).map((p) => p.id);
  if (!visible.length) return void res.json({ data: { projectCount: 0, byStatus: {}, myTasks: [], recent: [] } });
  const [statusRows, myTasks, recent] = await Promise.all([
    db.select({ status: tasks.status, n: count() }).from(tasks).where(inArray(tasks.projectId, visible)).groupBy(tasks.status),
    db.select({ id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate, version: tasks.version, projectId: tasks.projectId, key: projects.key, projectName: projects.name })
      .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.assigneeId, req.user.id), ne(tasks.status, 'done'), inArray(tasks.projectId, visible)))
      .orderBy(sql`${tasks.dueDate} asc nulls last`).limit(20),
    db.select({ log: activityLogs, actorName: users.name }).from(activityLogs).leftJoin(users, eq(users.id, activityLogs.userId))
      .where(inArray(activityLogs.projectId, visible)).orderBy(desc(activityLogs.createdAt)).limit(12),
  ]);
  res.json({ data: {
    projectCount: visible.length,
    byStatus: Object.fromEntries(statusRows.map((r) => [r.status, r.n])),
    myTasks: myTasks.map((t) => ({ ...t, code: `${t.key}-${t.number}` })),
    recent: recent.map((r) => ({ ...r.log, actorName: r.actorName })),
  } });
});
