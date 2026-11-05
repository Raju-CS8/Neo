import { and, eq } from 'drizzle-orm';
import type { User } from './auth';
import { db } from './db';
import { projectMembers, projects } from './db/schema';
import { ApiError, forbidden, notFound } from './http';

export type ProjectRole = 'admin' | 'project_manager' | 'team_member' | 'viewer';

/** The single permission table. Every project-scoped route goes through it. */
const RULES = {
  'project.read': ['admin', 'project_manager', 'team_member', 'viewer'],
  'project.update': ['admin', 'project_manager'],
  'member.manage': ['admin', 'project_manager'],
  'task.create': ['admin', 'project_manager'],
  'task.delete': ['admin', 'project_manager'],
  'task.assign': ['admin', 'project_manager'],
  'task.update_any': ['admin', 'project_manager'],
  'comment.create': ['admin', 'project_manager', 'team_member'],
  'comment.moderate': ['admin', 'project_manager'],
} as const satisfies Record<string, readonly ProjectRole[]>;

export type Action = keyof typeof RULES;
export const can = (role: ProjectRole, action: Action) => (RULES[action] as readonly ProjectRole[]).includes(role);

/** A global Viewer is read-only everywhere, whatever their membership row says. */
export function effectiveRole(user: Pick<User, 'role'>, memberRole: ProjectRole | undefined): ProjectRole | null {
  if (user.role === 'admin') return 'admin';
  if (!memberRole) return null;
  return user.role === 'viewer' ? 'viewer' : memberRole;
}

/** Highest project role a user's global role permits. */
export function allowedMemberRole(globalRole: User['role'], wanted: 'project_manager' | 'team_member' | 'viewer') {
  const rank = { viewer: 0, team_member: 1, project_manager: 2, admin: 2 } as const;
  return rank[wanted] <= rank[globalRole];
}

/** Team Members may edit content and status of tasks assigned to them, and nothing else. */
export function canUpdateTask(role: ProjectRole, userId: string, task: { assigneeId: string | null }, changes: { assigneeId?: unknown }) {
  if (can(role, 'task.update_any')) return true;
  return role === 'team_member' && task.assigneeId === userId && changes.assigneeId === undefined;
}

/**
 * Loads a project and checks the action. Non-members get 404, not 403, so
 * project existence does not leak. Writes to archived projects get 409.
 */
export async function authorize(user: User, projectId: string, action: Action, opts: { allowArchived?: boolean } = {}) {
  const [row] = await db.select({ project: projects, memberRole: projectMembers.role })
    .from(projects)
    .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, user.id)))
    .where(eq(projects.id, projectId));
  if (!row) throw notFound('Project');
  const role = effectiveRole(user, row.memberRole ?? undefined);
  if (!role) throw notFound('Project');
  if (!can(role, action)) throw forbidden();
  if (action !== 'project.read' && !opts.allowArchived && row.project.status === 'archived') {
    throw new ApiError(409, 'PROJECT_ARCHIVED', 'This project is archived and read-only.');
  }
  return { project: row.project, role };
}
