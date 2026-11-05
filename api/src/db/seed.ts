import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from './index';
import { activityLogs, comments, notifications, projectMembers, projects, tasks, users } from './schema';

export const SEED_PASSWORD = 'lockstep123';

export async function seed() {
  await db.execute(sql`truncate activity_logs, notifications, comments, tasks, project_members, projects, users cascade`);
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const mk = (name: string, handle: string, role: 'admin' | 'project_manager' | 'team_member' | 'viewer') =>
    ({ name, email: `${handle}@lockstep.test`, role, passwordHash });
  const [admin, priya, marcus, dana, leo, vera] = await db.insert(users).values([
    mk('Ada Admin', 'admin', 'admin'), mk('Priya Nair', 'priya', 'project_manager'), mk('Marcus Bell', 'marcus', 'team_member'),
    mk('Dana Okafor', 'dana', 'team_member'), mk('Leo Tanaka', 'leo', 'team_member'), mk('Vera Lund', 'vera', 'viewer'),
  ]).returning();

  const [atlas, portal, billing] = await db.insert(projects).values([
    { key: 'ATL', name: 'Atlas Migration', description: 'Move the customer ledger off the legacy billing database with zero data loss.', createdBy: admin.id },
    { key: 'CPV', name: 'Client Portal v2', description: 'Rebuild the client-facing portal with self-service reporting.', createdBy: admin.id },
    { key: 'BIL', name: 'Billing Rewrite', description: 'Replace the nightly invoice batch.', createdBy: admin.id, status: 'archived' },
  ]).returning();

  await db.insert(projectMembers).values([
    { projectId: atlas.id, userId: priya.id, role: 'project_manager' }, { projectId: atlas.id, userId: marcus.id, role: 'team_member' },
    { projectId: atlas.id, userId: dana.id, role: 'team_member' }, { projectId: atlas.id, userId: leo.id, role: 'team_member' },
    { projectId: atlas.id, userId: vera.id, role: 'viewer' },
    { projectId: portal.id, userId: priya.id, role: 'project_manager' }, { projectId: portal.id, userId: dana.id, role: 'team_member' },
    { projectId: portal.id, userId: vera.id, role: 'viewer' },
    { projectId: billing.id, userId: priya.id, role: 'project_manager' },
  ]);

  type S = 'todo' | 'in_progress' | 'in_review' | 'done';
  const list: [string, S, string, 'low' | 'medium' | 'high', number][] = [
    ['Export schema inventory', 'done', leo.id, 'medium', 3],
    ['Provision staging environment', 'done', marcus.id, 'high', 6],
    ['Load test the import pipeline', 'in_review', leo.id, 'high', 4],
    ['Rotate service credentials before cutover', 'in_review', marcus.id, 'high', 7],
    ['Backfill customer ledger in batches', 'in_progress', dana.id, 'high', 8],
    ['Add read replica for reporting', 'in_progress', marcus.id, 'medium', 5],
    ['Map legacy billing tables to the new schema', 'todo', leo.id, 'medium', 2],
    ['Draft cutover runbook', 'todo', priya.id, 'high', 1],
    ['Confirm retention rules with client', 'todo', dana.id, 'low', 3],
  ];
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const atlasTasks = await db.insert(tasks).values(list.map(([title, status, assigneeId, priority, version], i) => ({
    projectId: atlas.id, number: i + 1, title, status, assigneeId, priority, version, createdBy: priya.id,
    dueDate: status === 'done' ? null : day(i - 2),
    description: `${title}. Acceptance: reviewed by a second engineer and noted in the cutover runbook.`,
  }))).returning();
  await db.insert(tasks).values([
    { projectId: portal.id, number: 1, title: 'Design report filters', status: 'in_progress', assigneeId: dana.id, createdBy: priya.id },
    { projectId: portal.id, number: 2, title: 'Set up SSO for client users', status: 'todo', createdBy: priya.id },
  ]);
  await db.update(projects).set({ taskSeq: list.length }).where(sql`id = ${atlas.id}`);
  await db.update(projects).set({ taskSeq: 2 }).where(sql`id = ${portal.id}`);

  await db.insert(comments).values([
    { taskId: atlasTasks[4].id, authorId: dana.id, body: 'First 50k batch reconciled against the legacy totals.' },
    { taskId: atlasTasks[4].id, authorId: priya.id, body: '@marcus can you check replica lag during the next batch?' },
  ]);
  await db.insert(notifications).values([
    { userId: marcus.id, actorId: priya.id, type: 'mention', message: 'Priya Nair mentioned you on ATL-5', projectId: atlas.id, taskId: atlasTasks[4].id },
    { userId: dana.id, actorId: priya.id, type: 'assignment', message: 'Priya Nair assigned you ATL-5: Backfill customer ledger in batches', projectId: atlas.id, taskId: atlasTasks[4].id },
  ]);

  const actors = [priya, marcus, dana, leo];
  await db.insert(activityLogs).values(atlasTasks.flatMap((t, i) => {
    const actor = actors[i % 4];
    return [{
      userId: actor.id, projectId: atlas.id, action: 'task.updated', entityType: 'task', entityId: t.id,
      metadata: { code: `ATL-${t.number}`, title: t.title, fields: ['description'] }, createdAt: new Date(Date.now() - (i * 11 + 6) * 60000),
    }, {
      userId: actors[(i + 1) % 4].id, projectId: atlas.id, action: 'task.created', entityType: 'task', entityId: t.id,
      metadata: { code: `ATL-${t.number}`, title: t.title }, createdAt: new Date(Date.now() - (i * 13 + 20) * 60000),
    }];
  }));
  return { admin, priya, marcus, dana, leo, vera, atlas, portal, billing, atlasTasks };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed.ts')) {
  await seed();
  await pool.end();
  console.log(`Seeded. Password for every user: ${SEED_PASSWORD}`);
}
