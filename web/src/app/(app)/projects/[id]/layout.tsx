'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Failure } from '@/components/ui';
import { type Activity, api, describe, type Member, ROLE_LABEL, timeAgo } from '@/lib/api';
import { useMe } from '@/lib/providers';

const WINDOW_MS = 3 * 3600e3;

/** The signature view: one stave per teammate on a shared 3-hour time axis, each note a logged action. */
function Score({ projectId }: { projectId: string }) {
  const { data: me } = useMe();
  const { data: members } = useQuery({ queryKey: ['members', projectId], queryFn: () => api<{ data: Member[] }>(`/projects/${projectId}/members`).then((r) => r.data) });
  const { data: acts } = useQuery({ queryKey: ['activity', projectId, 'score'], queryFn: () => api<{ data: Activity[] }>(`/projects/${projectId}/activity?pageSize=100`).then((r) => r.data) });
  const seen = useRef<Set<string> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { if (acts) setNow(Date.now()); }, [acts]);
  const fresh = useMemo(() => {
    if (!acts) return new Set<string>();
    const ids = new Set(acts.map((a) => a.id));
    const out = seen.current ? new Set([...ids].filter((id) => !seen.current!.has(id))) : new Set<string>();
    seen.current = ids;
    return out;
  }, [acts]);
  const staves = members?.filter((m) => m.role !== 'viewer') ?? [];
  if (!staves.length) return null;
  return (
    <section aria-label="Team activity over the last three hours" className="panel py-2.5 mb-5">
      {staves.map((m) => (
        <div key={m.userId} className="grid grid-cols-[120px_1fr] items-center h-8 pr-3">
          <span className={`text-[13px] font-semibold pl-3 truncate ${m.userId === me?.id ? 'text-pencil' : ''}`}>{m.name}</span>
          <div className="stave"><div className="stave-bars" />
            {acts?.filter((a) => a.userId === m.userId && now - +new Date(a.createdAt) < WINDOW_MS).map((a) => {
              const left = 97 - ((now - +new Date(a.createdAt)) / WINDOW_MS) * 97;
              const label = `${m.name} ${describe(a)}, ${timeAgo(a.createdAt)}`;
              return <i key={a.id} role="img" aria-label={label} title={label} className={`note ${m.userId === me?.id ? 'note-mine' : ''} ${fresh.has(a.id) ? 'note-new' : ''}`} style={{ left: `${left}%` }} />;
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-ink-2 flex justify-between pl-[120px] pr-3 mt-1"><span>3 hours ago</span><span>Now</span></p>
    </section>
  );
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: p, error } = useQuery({ queryKey: ['project', id], queryFn: () => api(`/projects/${id}`).then((r) => r.data) });
  const setStatus = useMutation({
    mutationFn: (status: string) => api(`/projects/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id] }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); router.push('/projects'); },
  });
  if (error) return <Failure error={error} />;
  if (!p) return <p className="p-7 text-ink-2">Loading…</p>;
  const manage = p.myRole === 'admin' || p.myRole === 'project_manager';
  const tabs = [['tasks', 'Tasks'], ['team', 'Team'], ['activity', 'Activity']];
  return (
    <main className="p-7">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4">
        <h1 className="text-3xl font-extrabold tracking-tight">{p.name}</h1>
        <nav aria-label="Project" className="flex gap-4 font-semibold text-[15px]">
          {tabs.map(([seg, label]) => {
            const on = path.endsWith(`/${seg}`);
            return <Link key={seg} href={`/projects/${id}/${seg}`} aria-current={on ? 'page' : undefined} className={on ? 'border-b-[2.5px] border-ink' : 'text-ink-2 hover:text-ink'}>{label}</Link>;
          })}
        </nav>
        <span className="text-sm text-ink-2">Your access: {ROLE_LABEL[p.myRole as keyof typeof ROLE_LABEL]}{p.myRole === 'viewer' && ' (read only)'}</span>
        <div className="ml-auto flex gap-2">
          {manage && <button className="btn btn-quiet" onClick={() => setStatus.mutate(p.status === 'archived' ? 'active' : 'archived')}>{p.status === 'archived' ? 'Restore' : 'Archive'}</button>}
          {me?.role === 'admin' && <button className="btn btn-danger" onClick={() => { if (confirm(`Delete ${p.name} and all of its tasks? This cannot be undone.`)) remove.mutate(); }}>Delete</button>}
        </div>
      </div>
      {p.status === 'archived' && <p className="mb-4 text-sm font-semibold border border-ink rounded-md px-3 py-2 bg-white">This project is archived and read-only.</p>}
      <Score projectId={id} />
      {children}
    </main>
  );
}
