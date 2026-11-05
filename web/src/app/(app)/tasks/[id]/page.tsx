'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Failure, Mark } from '@/components/ui';
import { api, ApiErr, type Member, STATUSES, statusLabel, type Task, timeAgo } from '@/lib/api';
import { useMe } from '@/lib/providers';

type Draft = Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'assigneeId' | 'dueDate'>;
const FIELDS: (keyof Draft)[] = ['title', 'description', 'status', 'priority', 'assigneeId', 'dueDate'];
const LABEL: Record<keyof Draft, string> = { title: 'Title', description: 'Description', status: 'Status', priority: 'Priority', assigneeId: 'Assignee', dueDate: 'Due date' };
const pickDraft = (t: Task): Draft => ({ title: t.title, description: t.description, status: t.status, priority: t.priority, assigneeId: t.assigneeId, dueDate: t.dueDate });

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: task, error } = useQuery({ queryKey: ['task', id], queryFn: () => api(`/tasks/${id}`).then((r) => r.data) });
  const { data: members } = useQuery({ queryKey: ['members', task?.projectId], enabled: !!task, queryFn: () => api<{ data: Member[] }>(`/projects/${task.projectId}/members`).then((r) => r.data) });

  // `base` is the server state this draft was started from; its version is what we submit.
  const [base, setBase] = useState<Task | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conflict, setConflict] = useState<Task | null>(null);
  const dirty = !!(base && draft && FIELDS.some((f) => draft[f] !== base[f]));

  // Live updates flow straight into a clean form. A dirty form is left alone and warned instead.
  useEffect(() => {
    if (task && !dirty && !conflict) { setBase(task); setDraft(pickDraft(task)); }
  }, [task, dirty, conflict]);

  const changes = (from: Task) => Object.fromEntries(FIELDS.filter((f) => draft![f] !== from[f]).map((f) => [f, draft![f]]));
  const save = useMutation({
    mutationFn: (v: { version: number; body: object }) => api(`/tasks/${id}`, { method: 'PATCH', body: { version: v.version, ...v.body } }),
    onSuccess: (r) => { setConflict(null); setBase(r.data); setDraft(pickDraft(r.data)); qc.setQueryData(['task', id], (old: any) => ({ ...old, ...r.data })); },
    onError: (e) => { if (e instanceof ApiErr && e.code === 'VERSION_CONFLICT') setConflict(e.details.current); },
  });
  const del = useMutation({
    mutationFn: () => api(`/tasks/${id}?version=${base!.version}`, { method: 'DELETE' }),
    onSuccess: () => router.push(`/projects/${task.projectId}/tasks`),
    onError: (e) => { if (e instanceof ApiErr && e.code === 'VERSION_CONFLICT') setConflict(e.details.current); },
  });

  if (error) return <Failure error={error} />;
  if (!task || !draft || !base) return <p className="p-7 text-ink-2">Loading…</p>;

  const open = task.projectStatus === 'active';
  const manage = open && (task.myRole === 'admin' || task.myRole === 'project_manager');
  const canEdit = manage || (open && task.myRole === 'team_member' && task.assigneeId === me?.id);
  const behind = task.version > base.version && dirty && !conflict;
  const nameOf = (uid: string | null) => members?.find((m) => m.userId === uid)?.name ?? 'Unassigned';
  const show = (f: keyof Draft, v: unknown) => (f === 'status' ? statusLabel(String(v)) : f === 'assigneeId' ? nameOf(v as string | null) : (v as string) || 'Empty');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const saveError = save.error && !(save.error instanceof ApiErr && save.error.code === 'VERSION_CONFLICT') ? save.error.message : '';

  return (
    <main className="p-7 max-w-5xl">
      <p className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Link href={`/projects/${task.projectId}/tasks`} className="underline">{task.projectName}</Link> / {task.code} <Mark v={base.version} className={behind ? 'text-redpencil' : ''} />
      </p>
      {behind && <p role="status" className="mb-4 rounded-md bg-pencil-wash text-pencil font-semibold text-sm px-3 py-2">Someone just saved version {task.version}. Saving your edits will ask you to review the differences.</p>}
      {conflict && (
        <section role="alert" className="mb-5 rounded-md border-2 border-redpencil bg-white p-4">
          <h2 className="text-lg font-extrabold text-redpencil">This task changed while you were editing</h2>
          <p className="text-sm mb-3">Your edits were based on version {base.version}. The latest is version {conflict.version}. Nothing has been overwritten.</p>
          <table className="w-full text-sm mb-3">
            <thead><tr className="text-left"><th className="py-1 pr-3">Field</th><th className="pr-3">Your edit</th><th className="pr-3">Latest saved</th></tr></thead>
            <tbody>
              {FIELDS.filter((f) => draft[f] !== conflict[f]).map((f) => (
                <tr key={f} className="border-t border-line align-top">
                  <th scope="row" className="py-1.5 pr-3 text-left font-semibold">{LABEL[f]}</th>
                  <td className="pr-3 text-pencil font-medium">{show(f, draft[f])}</td><td className="pr-3">{show(f, conflict[f])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-quiet" onClick={() => { setBase(conflict); setDraft(pickDraft(conflict)); setConflict(null); qc.invalidateQueries({ queryKey: ['task', id] }); }}>Discard mine, use latest</button>
            <button className="btn" onClick={() => save.mutate({ version: conflict.version, body: changes(conflict) })}>Apply my edits on top of latest</button>
          </div>
        </section>
      )}
      <div className="grid lg:grid-cols-[1fr_300px] gap-6">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ version: base.version, body: changes(base) }); }}>
          <div><label className="label" htmlFor="t">Title</label><input id="t" required disabled={!canEdit} className="field !text-xl !font-extrabold" value={draft.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div><label className="label" htmlFor="d">Description</label><textarea id="d" rows={6} disabled={!canEdit} className="field" value={draft.description} onChange={(e) => set('description', e.target.value)} /></div>
          {saveError && <p role="alert" className="text-sm font-semibold text-redpencil">{saveError}</p>}
          {canEdit && <div className="flex gap-2">
            <button className="btn" disabled={!dirty || save.isPending || !!conflict}>Save changes</button>
            {dirty && <button type="button" className="btn btn-quiet" onClick={() => { setBase(task); setDraft(pickDraft(task)); }}>Discard</button>}
          </div>}
          {!canEdit && <p className="text-sm text-ink-2">{task.myRole === 'viewer' ? 'You have read-only access.' : 'Only the assignee or a Project Manager can edit this task.'}</p>}
        </form>
        <aside className="panel p-4 space-y-3 self-start">
          <div><label className="label" htmlFor="s">Status</label><select id="s" disabled={!canEdit} className="field" value={draft.status} onChange={(e) => set('status', e.target.value as Task['status'])}>{STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
          <div><label className="label" htmlFor="p">Priority</label><select id="p" disabled={!canEdit} className="field" value={draft.priority} onChange={(e) => set('priority', e.target.value as Task['priority'])}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
          <div><label className="label" htmlFor="a">Assignee</label><select id="a" disabled={!manage} className="field" value={draft.assigneeId ?? ''} onChange={(e) => set('assigneeId', e.target.value || null)}><option value="">Unassigned</option>{members?.filter((m) => m.role !== 'viewer').map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></div>
          <div><label className="label" htmlFor="due">Due date</label><input id="due" type="date" disabled={!canEdit} className="field" value={draft.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || null)} /></div>
          {manage && <button type="button" className="btn btn-danger w-full justify-center" onClick={() => { if (confirm(`Delete ${task.code}? This cannot be undone.`)) del.mutate(); }}>Delete task</button>}
        </aside>
      </div>
      <Comments taskId={id} canComment={open && task.myRole !== 'viewer'} moderate={!!manage} meId={me?.id} />
    </main>
  );
}

function Comments({ taskId, canComment, moderate, meId }: { taskId: string; canComment: boolean; moderate: boolean; meId?: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const { data } = useQuery({ queryKey: ['comments', taskId], queryFn: () => api(`/tasks/${taskId}/comments`).then((r) => r.data) });
  const done = () => qc.invalidateQueries({ queryKey: ['comments', taskId] });
  const add = useMutation({ mutationFn: () => api(`/tasks/${taskId}/comments`, { method: 'POST', body: { body } }), onSuccess: () => { setBody(''); done(); } });
  const del = useMutation({ mutationFn: (cid: string) => api(`/comments/${cid}`, { method: 'DELETE' }), onSuccess: done });
  return (
    <section className="mt-8 max-w-3xl">
      <h2 className="text-lg font-extrabold mb-2">Comments</h2>
      <ul className="space-y-2 mb-3">
        {data?.length === 0 && <li className="text-sm text-ink-2">No comments yet.</li>}
        {data?.map((c: any) => (
          <li key={c.id} className="panel p-3 text-sm">
            <p className="flex justify-between gap-3 mb-1"><b className="font-bold">{c.authorName ?? 'Former user'}</b><span className="text-ink-2">{timeAgo(c.createdAt)}
              {(moderate || (canComment && c.authorId === meId)) && <button className="ml-3 underline font-semibold cursor-pointer" onClick={() => del.mutate(c.id)}>Delete</button>}</span></p>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>
      {canComment && (
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <label className="label" htmlFor="c">Add a comment (use @name to mention someone)</label>
          <textarea id="c" rows={2} required className="field mb-2" value={body} onChange={(e) => setBody(e.target.value)} />
          {add.error && <p role="alert" className="text-sm font-semibold text-redpencil mb-2">{add.error.message}</p>}
          <button className="btn" disabled={add.isPending}>Comment</button>
        </form>
      )}
    </section>
  );
}
