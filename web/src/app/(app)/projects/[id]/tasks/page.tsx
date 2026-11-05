'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Failure, Mark } from '@/components/ui';
import { api, ApiErr, type Member, type Status, STATUSES, type Task } from '@/lib/api';
import { useLive, useMe } from '@/lib/providers';

export default function Board() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { say } = useLive();
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', assigneeId: '' });
  const [over, setOver] = useState<Status | null>(null);

  const { data: project } = useQuery({ queryKey: ['project', id], queryFn: () => api(`/projects/${id}`).then((r) => r.data) });
  const { data: members } = useQuery({ queryKey: ['members', id], queryFn: () => api<{ data: Member[] }>(`/projects/${id}/members`).then((r) => r.data) });
  const qs = new URLSearchParams({ pageSize: '200', ...(search && { search }), ...(assignee && { assigneeId: assignee }) });
  const { data: tasks, error } = useQuery({ queryKey: ['tasks', id, qs.toString()], queryFn: () => api<{ data: Task[] }>(`/projects/${id}/tasks?${qs}`).then((r) => r.data) });

  const move = useMutation({
    mutationFn: ({ t, status }: { t: Task; status: Status }) => api(`/tasks/${t.id}`, { method: 'PATCH', body: { version: t.version, status } }),
    onError: (e) => say(e instanceof ApiErr && e.code === 'VERSION_CONFLICT' ? 'Someone changed that task first. The board now shows the latest version.' : e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks', id] }),
  });
  const create = useMutation({
    mutationFn: () => api(`/projects/${id}/tasks`, { method: 'POST', body: { title: draft.title, assigneeId: draft.assigneeId || null } }),
    onSuccess: () => { setDraft({ title: '', assigneeId: '' }); setAdding(false); },
  });

  if (error) return <Failure error={error} />;
  const role = project?.myRole;
  const live = project?.status === 'active';
  const manage = live && (role === 'admin' || role === 'project_manager');
  const canMove = (t: Task) => live && (manage || (role === 'team_member' && t.assigneeId === me?.id));
  const workers = members?.filter((m) => m.role !== 'viewer') ?? [];

  return (
    <>
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div><label className="label" htmlFor="q">Search</label><input id="q" className="field !w-56" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div><label className="label" htmlFor="as">Assignee</label>
          <select id="as" className="field !w-44" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Everyone</option>{workers.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select></div>
        {manage && <button className="btn ml-auto" onClick={() => setAdding(!adding)}>New task</button>}
      </div>
      {adding && (
        <form className="panel p-3 mb-4 flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="flex-1 min-w-60"><label className="label" htmlFor="nt">Title</label><input id="nt" autoFocus required className="field" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
          <div><label className="label" htmlFor="na">Assign to</label>
            <select id="na" className="field !w-44" value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })}>
              <option value="">Unassigned</option>{workers.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </select></div>
          <button className="btn" disabled={create.isPending}>Create task</button>
          {create.error && <p role="alert" className="w-full text-sm font-semibold text-redpencil">{create.error.message}</p>}
        </form>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {STATUSES.map((col) => {
          const items = tasks?.filter((t) => t.status === col.id) ?? [];
          return (
            <section key={col.id} aria-label={col.label}
              className={`rounded-md p-1 min-h-40 ${over === col.id ? 'bg-pencil-wash' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(col.id); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                setOver(null);
                const t = tasks?.find((x) => x.id === e.dataTransfer.getData('text/plain'));
                if (t && t.status !== col.id && canMove(t)) move.mutate({ t, status: col.id });
              }}>
              <h2 className="font-extrabold flex justify-between mb-2 px-1">{col.label}<span>{items.length}</span></h2>
              {items.map((t) => (
                <article key={t.id} draggable={canMove(t)} onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                  className={`bg-white rounded-md p-3 mb-2.5 border ${t.assigneeId === me?.id ? 'border-pencil border-2' : 'border-line'}`}>
                  <Link href={`/tasks/${t.id}`} className="font-semibold text-[15px] leading-snug hover:underline block mb-2">{t.title}</Link>
                  <div className="flex items-center justify-between text-[12.5px] font-medium gap-2">
                    <span className="truncate">{t.code} · {t.assigneeName?.split(' ')[0] ?? 'Unassigned'}{t.priority === 'high' && ' · High'}</span>
                    <Mark v={t.version} />
                  </div>
                  {canMove(t) && (
                    <select aria-label={`Status of ${t.code}`} className="field !py-1 !text-xs mt-2" value={t.status} onChange={(e) => move.mutate({ t, status: e.target.value as Status })}>
                      {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
