export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiErr extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method: init?.method ?? 'GET', credentials: 'include',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiErr(0, 'NETWORK', 'Cannot reach the server. Check that the API is running.');
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiErr(res.status, json.error?.code ?? 'ERROR', json.error?.message ?? 'Request failed.', json.error?.details);
  return json;
}

export type Role = 'admin' | 'project_manager' | 'team_member' | 'viewer';
export type Status = 'todo' | 'in_progress' | 'in_review' | 'done';
export type Me = { id: string; name: string; email: string; role: Role };
export type Task = {
  id: string; projectId: string; code: string; title: string; description: string; status: Status; priority: 'low' | 'medium' | 'high';
  assigneeId: string | null; assigneeName: string | null; dueDate: string | null; version: number; updatedAt: string;
};
export type Member = { userId: string; name: string; email: string; role: Exclude<Role, 'admin'>; globalRole: Role };
export type Activity = { id: string; userId: string | null; actorName: string | null; projectId: string | null; action: string; entityType: string; entityId: string | null; metadata: any; createdAt: string };

export const STATUSES: { id: Status; label: string }[] = [
  { id: 'todo', label: 'To do' }, { id: 'in_progress', label: 'In progress' }, { id: 'in_review', label: 'In review' }, { id: 'done', label: 'Done' },
];
export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', project_manager: 'Project Manager', team_member: 'Team Member', viewer: 'Viewer' };
export const statusLabel = (s: string) => STATUSES.find((x) => x.id === s)?.label ?? s;

export function describe(a: Activity) {
  const m = a.metadata ?? {};
  const map: Record<string, string> = {
    'task.created': `created ${m.code}: ${m.title}`, 'task.updated': `edited ${m.code}`,
    'task.status_changed': `moved ${m.code} to ${statusLabel(m.to)}`, 'task.assigned': `assigned ${m.code} to ${m.assignee ?? 'nobody'}`,
    'task.deleted': `deleted ${m.code}`, 'comment.added': `commented on ${m.code}`, 'comment.deleted': 'deleted a comment',
    'member.added': `added ${m.name} to the project`, 'member.removed': `removed ${m.name}`, 'member.role_changed': `changed ${m.name}'s role`,
    'project.created': `created project ${m.name}`, 'project.updated': `updated project ${m.name}`, 'project.archived': `archived ${m.name}`,
    'project.restored': `restored ${m.name}`, 'project.deleted': `deleted project ${m.name}`,
    'user.created': `created user ${m.name}`, 'user.updated': `updated user ${m.name}`, 'user.deactivated': `deactivated ${m.name}`,
  };
  return map[a.action] ?? a.action;
}

export const timeAgo = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.round(min / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
};
