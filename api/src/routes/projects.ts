import { and, count, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth';
import { db } from '../db';
import { activityLogs, projectMembers, projects, tasks, users } from '../db/schema';
import { ApiError, forbidden, notFound, pageQuery, paged, uuidParam } from '../http';
import { allowedMemberRole, authorize, effectiveRole } from '../policy';
import { joinProject, leaveProject, Outbox } from '../realtime';

export const projectRoutes = Router();
projectRoutes.use(requireAuth);

const memberRoleEnum = z.enum(['project_manager', 'team_member', 'viewer']);

projectRoutes.get('/', async (req, res) => {
  const q = pageQuery.extend({ status: z.enum(['active', 'archived']).optional() }).parse(req.query);
  const isAdmin = req.user.role === 'admin';
  const membership = and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, req.user.id));
  const where = and(
    q.status ? eq(projects.status, q.status) : undefined,
    isAdmin ? undefined : sql`${projectMembers.userId} is not null`,
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      project: projects, memberRole: projectMembers.role,
      taskCount: sql<number>`(select count(*)::int from ${tasks} where ${tasks.projectId} = ${projects.id})`,
      doneCount: sql<number>`(select count(*)::int from ${tasks} where ${tasks.projectId} = ${projects.id} and ${tasks.status} = 'done')`,
    }).from(projects).leftJoin(projectMembers, membership).where(where)
      .orderBy(desc(projects.updatedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(projects).leftJoin(projectMembers, membership).where(where),
  ]);
  res.json(paged(rows.map((r) => ({
    ...r.project, taskCount: r.taskCount, doneCount: r.doneCount,
    myRole: effectiveRole(req.user, r.memberRole ?? undefined),
  })), q.page, q.pageSize, total));
});

projectRoutes.post('/', requireAdmin, async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(120),
    key: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, 'Use 2 to 6 letters'),
    description: z.string().max(2000).default(''),
    managerId: z.string().uuid().optional(),
  }).parse(req.body);
  const out = new Outbox(req.user);
  const project = await db.transaction(async (tx) => {
    const [p] = await tx.insert(projects).values({ name: body.name, key: body.key, description: body.description, createdBy: req.user.id }).returning();
    await out.activity(tx, { projectId: p.id, action: 'project.created', entityType: 'project', entityId: p.id, metadata: { name: p.name } });
    if (body.managerId) {
      const [m] = await tx.select().from(users).where(eq(users.id, body.managerId));
      if (!m || !allowedMemberRole(m.role, 'project_manager')) throw new ApiError(400, 'INVALID_MANAGER', 'That user cannot manage a project.');
      await tx.insert(projectMembers).values({ projectId: p.id, userId: m.id, role: 'project_manager' });
      await out.activity(tx, { projectId: p.id, action: 'member.added', entityType: 'user', entityId: m.id, metadata: { name: m.name, role: 'project_manager' } });
      await out.notify(tx, [m.id], { type: 'membership', message: `You are now managing ${p.name}`, projectId: p.id });
    }
    return p;
  });
  if (body.managerId) joinProject(body.managerId, project.id);
  out.flush();
  res.status(201).json({ data: project });
});

projectRoutes.get('/:id', async (req, res) => {
  const { project, role } = await authorize(req.user, uuidParam.parse(req.params.id), 'project.read');
  res.json({ data: { ...project, myRole: role } });
});

projectRoutes.patch('/:id', async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const body = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).optional(),
    status: z.enum(['active', 'archived']).optional(),
  }).parse(req.body);
  const { project: before } = await authorize(req.user, id, 'project.update', { allowArchived: body.status === 'active' });
  const out = new Outbox(req.user);
  const project = await db.transaction(async (tx) => {
    const [p] = await tx.update(projects).set({ ...body, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
    const action = body.status && body.status !== before.status ? (body.status === 'archived' ? 'project.archived' : 'project.restored') : 'project.updated';
    await out.activity(tx, { projectId: id, action, entityType: 'project', entityId: id, metadata: { name: p.name } });
    out.event(id, 'project.updated', p);
    return p;
  });
  out.flush();
  res.json({ data: project });
});

projectRoutes.delete('/:id', requireAdmin, async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const { project } = await authorize(req.user, id, 'project.read');
  const out = new Outbox(req.user);
  await db.transaction(async (tx) => {
    out.event(id, 'project.deleted', { id });
    await out.activity(tx, { projectId: null, action: 'project.deleted', entityType: 'project', entityId: id, metadata: { name: project.name } });
    await tx.delete(projects).where(eq(projects.id, id));
  });
  out.flush();
  res.status(204).end();
});

/* ---------- members ---------- */
const listMembers = (projectId: string) => db.select({
  userId: users.id, name: users.name, email: users.email, globalRole: users.role, isActive: users.isActive, role: projectMembers.role, joinedAt: projectMembers.createdAt,
}).from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId)).where(eq(projectMembers.projectId, projectId)).orderBy(users.name);

projectRoutes.get('/:id/members', async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  await authorize(req.user, id, 'project.read');
  res.json({ data: await listMembers(id) });
});

/** Only an Admin can grant or take away the Project Manager role. */
const guardManagerChange = (actorIsAdmin: boolean, ...roles: (string | undefined)[]) => {
  if (!actorIsAdmin && roles.includes('project_manager')) throw forbidden('Only an Admin can assign or remove a Project Manager.');
};

projectRoutes.post('/:id/members', async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const body = z.object({ userId: z.string().uuid(), role: memberRoleEnum }).parse(req.body);
  const { project } = await authorize(req.user, id, 'member.manage');
  guardManagerChange(req.user.role === 'admin', body.role);
  const [target] = await db.select().from(users).where(eq(users.id, body.userId));
  if (!target?.isActive) throw notFound('User');
  if (!allowedMemberRole(target.role, body.role)) throw new ApiError(400, 'ROLE_NOT_ALLOWED', `${target.name}'s account role does not allow that project role.`);
  const out = new Outbox(req.user);
  await db.transaction(async (tx) => {
    await tx.insert(projectMembers).values({ projectId: id, userId: body.userId, role: body.role });
    await out.activity(tx, { projectId: id, action: 'member.added', entityType: 'user', entityId: body.userId, metadata: { name: target.name, role: body.role } });
    await out.notify(tx, [body.userId], { type: 'membership', message: `You were added to ${project.name}`, projectId: id });
    out.event(id, 'member.changed', { userId: body.userId });
  });
  joinProject(body.userId, id);
  out.flush();
  res.status(201).json({ data: await listMembers(id) });
});

projectRoutes.patch('/:id/members/:userId', async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const userId = uuidParam.parse(req.params.userId);
  const { role } = z.object({ role: memberRoleEnum }).parse(req.body);
  const { project } = await authorize(req.user, id, 'member.manage');
  const [row] = await db.select({ role: projectMembers.role, name: users.name, globalRole: users.role }).from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId)).where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)));
  if (!row) throw notFound('Member');
  guardManagerChange(req.user.role === 'admin', role, row.role);
  if (!allowedMemberRole(row.globalRole, role)) throw new ApiError(400, 'ROLE_NOT_ALLOWED', `${row.name}'s account role does not allow that project role.`);
  const out = new Outbox(req.user);
  await db.transaction(async (tx) => {
    await tx.update(projectMembers).set({ role }).where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)));
    await out.activity(tx, { projectId: id, action: 'member.role_changed', entityType: 'user', entityId: userId, metadata: { name: row.name, from: row.role, to: role } });
    await out.notify(tx, [userId], { type: 'membership', message: `Your role on ${project.name} changed`, projectId: id });
    out.event(id, 'member.changed', { userId });
  });
  out.flush();
  res.json({ data: await listMembers(id) });
});

projectRoutes.delete('/:id/members/:userId', async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const userId = uuidParam.parse(req.params.userId);
  const { project } = await authorize(req.user, id, 'member.manage');
  const [row] = await db.select({ role: projectMembers.role, name: users.name }).from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId)).where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)));
  if (!row) throw notFound('Member');
  guardManagerChange(req.user.role === 'admin', row.role);
  const out = new Outbox(req.user);
  await db.transaction(async (tx) => {
    await tx.delete(projectMembers).where(and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId)));
    // Unassign, bumping version so anyone editing these tasks sees the change.
    await tx.update(tasks).set({ assigneeId: null, version: sql`${tasks.version} + 1`, updatedAt: new Date() }).where(and(eq(tasks.projectId, id), eq(tasks.assigneeId, userId)));
    await out.activity(tx, { projectId: id, action: 'member.removed', entityType: 'user', entityId: userId, metadata: { name: row.name } });
    await out.notify(tx, [userId], { type: 'membership', message: `You were removed from ${project.name}`, projectId: id });
    out.event(id, 'member.changed', { userId });
  });
  out.flush();
  leaveProject(userId, id);
  res.status(204).end();
});

/* ---------- project activity ---------- */
projectRoutes.get('/:id/activity', async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const q = pageQuery.parse(req.query);
  await authorize(req.user, id, 'project.read');
  const [rows, [{ total }]] = await Promise.all([
    db.select({ log: activityLogs, actorName: users.name }).from(activityLogs).leftJoin(users, eq(users.id, activityLogs.userId))
      .where(eq(activityLogs.projectId, id)).orderBy(desc(activityLogs.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(activityLogs).where(eq(activityLogs.projectId, id)),
  ]);
  res.json(paged(rows.map((r) => ({ ...r.log, actorName: r.actorName })), q.page, q.pageSize, total));
});
