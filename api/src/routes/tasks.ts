import { and, asc, count, desc, eq, ilike, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { db, type Tx } from '../db';
import { comments, projectMembers, projects, tasks, users } from '../db/schema';
import { ApiError, forbidden, notFound, pageQuery, paged, uuidParam } from '../http';
import { authorize, can, canUpdateTask } from '../policy';
import { Outbox } from '../realtime';

export const taskRoutes = Router();
taskRoutes.use(requireAuth);

const statusEnum = z.enum(['todo', 'in_progress', 'in_review', 'done']);
const priorityEnum = z.enum(['low', 'medium', 'high']);
const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', in_review: 'In review', done: 'Done' } as const;
const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

const taskSelect = {
  id: tasks.id, projectId: tasks.projectId, number: tasks.number, title: tasks.title, description: tasks.description,
  status: tasks.status, priority: tasks.priority, assigneeId: tasks.assigneeId, assigneeName: users.name, dueDate: tasks.dueDate,
  version: tasks.version, createdBy: tasks.createdBy, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt, key: projects.key,
};
const baseQuery = (client: Tx | typeof db = db) => client.select(taskSelect).from(tasks)
  .innerJoin(projects, eq(projects.id, tasks.projectId)).leftJoin(users, eq(users.id, tasks.assigneeId));
type Row = Awaited<ReturnType<typeof baseQuery>>[number];
const dto = ({ key, ...t }: Row) => ({ ...t, code: `${key}-${t.number}` });

async function loadTask(id: string, client: Tx | typeof db = db) {
  const [row] = await baseQuery(client).where(eq(tasks.id, id));
  if (!row) throw notFound('Task');
  return dto(row);
}

async function assertAssignable(tx: Tx, projectId: string, userId: string) {
  const [m] = await tx.select({ role: projectMembers.role }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  if (!m || m.role === 'viewer') throw new ApiError(400, 'INVALID_ASSIGNEE', 'Tasks can only be assigned to working members of this project.');
}

const conflict = (current: unknown) => new ApiError(409, 'VERSION_CONFLICT', 'This task changed since you opened it.', { current });

/* ---------- tasks ---------- */
taskRoutes.get('/projects/:id/tasks', async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const q = pageQuery.extend({
    status: statusEnum.optional(), assigneeId: z.string().uuid().optional(), search: z.string().optional(),
  }).parse(req.query);
  await authorize(req.user, id, 'project.read');
  const where = and(
    eq(tasks.projectId, id),
    q.status ? eq(tasks.status, q.status) : undefined,
    q.assigneeId ? eq(tasks.assigneeId, q.assigneeId) : undefined,
    q.search ? ilike(tasks.title, `%${q.search}%`) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    baseQuery().where(where).orderBy(desc(tasks.updatedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: count() }).from(tasks).where(where),
  ]);
  res.json(paged(rows.map(dto), q.page, q.pageSize, total));
});

taskRoutes.post('/projects/:id/tasks', async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const body = z.object({
    title: z.string().trim().min(1).max(200), description: z.string().max(10000).default(''),
    status: statusEnum.default('todo'), priority: priorityEnum.default('medium'),
    assigneeId: z.string().uuid().nullable().default(null), dueDate: dueDate.default(null),
  }).parse(req.body);
  const { project } = await authorize(req.user, id, 'task.create');
  const out = new Outbox(req.user);
  const task = await db.transaction(async (tx) => {
    if (body.assigneeId) await assertAssignable(tx, id, body.assigneeId);
    // Row lock on the project makes per-project numbering gap-free under concurrency.
    const [{ taskSeq }] = await tx.update(projects).set({ taskSeq: sql`${projects.taskSeq} + 1` }).where(eq(projects.id, id)).returning({ taskSeq: projects.taskSeq });
    const [{ id: taskId }] = await tx.insert(tasks).values({ ...body, projectId: id, number: taskSeq, createdBy: req.user.id }).returning({ id: tasks.id });
    const t = await loadTask(taskId, tx);
    await out.activity(tx, { projectId: id, action: 'task.created', entityType: 'task', entityId: taskId, metadata: { code: t.code, title: t.title } });
    if (body.assigneeId) await out.notify(tx, [body.assigneeId], { type: 'assignment', message: `${req.user.name} assigned you ${t.code}: ${t.title}`, projectId: id, taskId });
    out.event(id, 'task.created', t);
    return t;
  });
  out.flush();
  res.status(201).json({ data: { ...task, projectName: project.name } });
});

async function readableTask(req: Parameters<Parameters<typeof taskRoutes.get>[1]>[0]) {
  const task = await loadTask(uuidParam.parse(req.params.id));
  const access = await authorize(req.user, task.projectId, 'project.read').catch((e) => {
    throw e instanceof ApiError && e.status === 404 ? notFound('Task') : e;
  });
  return { task, ...access };
}

taskRoutes.get('/tasks/:id', async (req, res) => {
  const { task, project, role } = await readableTask(req);
  res.json({ data: { ...task, projectName: project.name, projectStatus: project.status, myRole: role } });
});

taskRoutes.patch('/tasks/:id', async (req, res) => {
  const body = z.object({
    version: z.number().int().positive(), // the version this edit was based on
    title: z.string().trim().min(1).max(200).optional(), description: z.string().max(10000).optional(),
    status: statusEnum.optional(), priority: priorityEnum.optional(),
    assigneeId: z.string().uuid().nullable().optional(), dueDate: dueDate.optional(),
  }).strict().parse(req.body);
  const { version, ...changes } = body;
  const { task: before, role, project } = await readableTask(req);
  if (project.status === 'archived') throw new ApiError(409, 'PROJECT_ARCHIVED', 'This project is archived and read-only.');
  if (changes.assigneeId !== undefined && !can(role, 'task.assign')) throw forbidden('Only a Project Manager or Admin can assign tasks.');
  if (!canUpdateTask(role, req.user.id, before, changes)) throw forbidden('You can only update tasks assigned to you.');

  const out = new Outbox(req.user);
  const task = await db.transaction(async (tx) => {
    if (changes.assigneeId) await assertAssignable(tx, before.projectId, changes.assigneeId);
    // The compare-and-swap. Version check and write are one atomic statement,
    // so two concurrent writers based on the same version cannot both succeed.
    const updated = await tx.update(tasks)
      .set({ ...changes, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(and(eq(tasks.id, before.id), eq(tasks.version, version)))
      .returning({ id: tasks.id });
    if (!updated.length) throw conflict(await loadTask(before.id, tx));

    const t = await loadTask(before.id, tx);
    const log = (action: string, metadata: Record<string, unknown>) => out.activity(tx, {
      projectId: t.projectId, action, entityType: 'task', entityId: t.id, metadata: { code: t.code, title: t.title, version: t.version, ...metadata },
    });
    const statusChanged = changes.status !== undefined && changes.status !== before.status;
    const assigneeChanged = changes.assigneeId !== undefined && changes.assigneeId !== before.assigneeId;
    if (statusChanged) {
      await log('task.status_changed', { from: before.status, to: t.status });
      await out.notify(tx, [t.assigneeId, t.createdBy], { type: 'status', message: `${req.user.name} moved ${t.code} to ${STATUS_LABEL[t.status]}`, projectId: t.projectId, taskId: t.id });
    }
    if (assigneeChanged) {
      await log('task.assigned', { assignee: t.assigneeName });
      await out.notify(tx, [t.assigneeId], { type: 'assignment', message: `${req.user.name} assigned you ${t.code}: ${t.title}`, projectId: t.projectId, taskId: t.id });
    }
    if (!statusChanged && !assigneeChanged) await log('task.updated', { fields: Object.keys(changes) });
    out.event(t.projectId, 'task.updated', t);
    return t;
  });
  out.flush();
  res.json({ data: task });
});

taskRoutes.delete('/tasks/:id', async (req, res) => {
  const version = z.coerce.number().int().positive().parse(req.query.version);
  const before = await loadTask(uuidParam.parse(req.params.id));
  await authorize(req.user, before.projectId, 'task.delete').catch((e) => {
    throw e instanceof ApiError && e.status === 404 ? notFound('Task') : e;
  });
  const out = new Outbox(req.user);
  await db.transaction(async (tx) => {
    const gone = await tx.delete(tasks).where(and(eq(tasks.id, before.id), eq(tasks.version, version))).returning({ id: tasks.id });
    if (!gone.length) throw conflict(await loadTask(before.id, tx));
    await out.activity(tx, { projectId: before.projectId, action: 'task.deleted', entityType: 'task', entityId: before.id, metadata: { code: before.code, title: before.title } });
    out.event(before.projectId, 'task.deleted', { id: before.id });
  });
  out.flush();
  res.status(204).end();
});

/* ---------- comments ---------- */
taskRoutes.get('/tasks/:id/comments', async (req, res) => {
  const { task } = await readableTask(req);
  const rows = await db.select({ id: comments.id, taskId: comments.taskId, authorId: comments.authorId, authorName: users.name, body: comments.body, createdAt: comments.createdAt })
    .from(comments).leftJoin(users, eq(users.id, comments.authorId)).where(eq(comments.taskId, task.id)).orderBy(asc(comments.createdAt));
  res.json({ data: rows });
});

taskRoutes.post('/tasks/:id/comments', async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(req.body);
  const { task, role, project } = await readableTask(req);
  if (!can(role, 'comment.create')) throw forbidden('Viewers cannot comment.');
  if (project.status === 'archived') throw new ApiError(409, 'PROJECT_ARCHIVED', 'This project is archived and read-only.');
  const out = new Outbox(req.user);
  const comment = await db.transaction(async (tx) => {
    const [c] = await tx.insert(comments).values({ taskId: task.id, authorId: req.user.id, body }).returning();
    await out.activity(tx, { projectId: task.projectId, action: 'comment.added', entityType: 'comment', entityId: c.id, metadata: { code: task.code, taskId: task.id } });
    // @handle matches a project member's first name or email local part.
    const handles = new Set([...body.matchAll(/@([\w.-]+)/g)].map((m) => m[1].toLowerCase()));
    const members = await tx.select({ id: users.id, name: users.name, email: users.email }).from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId)).where(eq(projectMembers.projectId, task.projectId));
    const mentioned = members.filter((m) => handles.has(m.name.split(' ')[0].toLowerCase()) || handles.has(m.email.split('@')[0].toLowerCase())).map((m) => m.id);
    await out.notify(tx, mentioned, { type: 'mention', message: `${req.user.name} mentioned you on ${task.code}`, projectId: task.projectId, taskId: task.id });
    const others = [task.assigneeId, task.createdBy].filter((id) => id && !mentioned.includes(id));
    await out.notify(tx, others, { type: 'comment', message: `${req.user.name} commented on ${task.code}`, projectId: task.projectId, taskId: task.id });
    const dtoComment = { ...c, authorName: req.user.name };
    out.event(task.projectId, 'comment.created', dtoComment);
    return dtoComment;
  });
  out.flush();
  res.status(201).json({ data: comment });
});

taskRoutes.delete('/comments/:id', async (req, res) => {
  const id = uuidParam.parse(req.params.id);
  const [row] = await db.select({ comment: comments, projectId: tasks.projectId }).from(comments).innerJoin(tasks, eq(tasks.id, comments.taskId)).where(eq(comments.id, id));
  if (!row) throw notFound('Comment');
  const { role } = await authorize(req.user, row.projectId, 'project.read').catch((e) => {
    throw e instanceof ApiError && e.status === 404 ? notFound('Comment') : e;
  });
  const isOwnAndActive = row.comment.authorId === req.user.id && role !== 'viewer';
  if (!isOwnAndActive && !can(role, 'comment.moderate')) throw forbidden('You can only delete your own comments.');
  const out = new Outbox(req.user);
  await db.transaction(async (tx) => {
    await tx.delete(comments).where(eq(comments.id, id));
    await out.activity(tx, { projectId: row.projectId, action: 'comment.deleted', entityType: 'comment', entityId: id, metadata: {} });
    out.event(row.projectId, 'comment.deleted', { id, taskId: row.comment.taskId });
  });
  out.flush();
  res.status(204).end();
});
