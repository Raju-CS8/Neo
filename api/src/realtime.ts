import { parse } from 'cookie';
import { eq } from 'drizzle-orm';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { COOKIE, type User, userFromToken } from './auth';
import { db, type Tx } from './db';
import { activityLogs, notifications, projectMembers } from './db/schema';
import { env } from './env';

let io: Server | undefined;
const projectRoom = (id: string) => `project:${id}`;
const userRoom = (id: string) => `user:${id}`;

export function attachRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.WEB_ORIGIN, credentials: true } });
  // Same session cookie as REST. Rooms are assigned by the server; clients cannot subscribe themselves.
  io.use(async (socket, next) => {
    const user = await userFromToken(parse(socket.handshake.headers.cookie ?? '')[COOKIE]);
    if (!user) return next(new Error('UNAUTHENTICATED'));
    socket.data.user = user;
    next();
  });
  io.on('connection', async (socket) => {
    const user = socket.data.user as User;
    socket.join(userRoom(user.id));
    if (user.role === 'admin') socket.join('admins');
    const rows = await db.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, user.id));
    socket.join(rows.map((r) => projectRoom(r.id)));
    socket.emit('ready');
  });
  return io;
}

export const joinProject = (userId: string, projectId: string) => io?.in(userRoom(userId)).socketsJoin(projectRoom(projectId));
export const leaveProject = (userId: string, projectId: string) => io?.in(userRoom(userId)).socketsLeave(projectRoom(projectId));
export const dropUser = (userId: string) => io?.in(userRoom(userId)).disconnectSockets(true);

type Emit = () => void;

/**
 * Collects side effects during a transaction. DB rows are written inside the
 * transaction; socket messages leave only after commit, via flush(), so clients
 * never hear about a change that was rolled back.
 */
export class Outbox {
  private queue: Emit[] = [];
  constructor(private actor: User) {}

  event(projectId: string, type: string, data: unknown) {
    this.queue.push(() => io?.to([projectRoom(projectId), 'admins']).emit('event', { type, projectId, data }));
  }

  async activity(tx: Tx, a: { projectId: string | null; action: string; entityType: string; entityId?: string; metadata?: Record<string, unknown> }) {
    const [row] = await tx.insert(activityLogs).values({ ...a, userId: this.actor.id }).returning();
    const payload = { ...row, actorName: this.actor.name };
    this.queue.push(() => {
      const rooms = a.projectId ? [projectRoom(a.projectId), 'admins'] : ['admins'];
      io?.to(rooms).emit('event', { type: 'activity.created', projectId: a.projectId, data: payload });
    });
  }

  async notify(tx: Tx, userIds: (string | null | undefined)[], n: { type: string; message: string; projectId?: string; taskId?: string }) {
    const recipients = [...new Set(userIds.filter((id): id is string => !!id && id !== this.actor.id))];
    if (!recipients.length) return;
    const rows = await tx.insert(notifications).values(recipients.map((userId) => ({ ...n, userId, actorId: this.actor.id }))).returning();
    for (const row of rows) this.queue.push(() => io?.to(userRoom(row.userId)).emit('notification', row));
  }

  flush() { this.queue.forEach((emit) => emit()); }
}
