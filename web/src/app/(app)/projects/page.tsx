'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Empty, Failure, Page } from '@/components/ui';
import { api, ROLE_LABEL } from '@/lib/api';
import { useMe } from '@/lib/providers';

export default function Projects() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', key: '', description: '', managerId: '' });
  const { data, error } = useQuery({ queryKey: ['projects', 'all'], queryFn: () => api('/projects') });
  const { data: managers } = useQuery({ queryKey: ['users', 'pm'], enabled: me?.role === 'admin', queryFn: () => api('/users?role=project_manager') });
  const create = useMutation({
    mutationFn: () => api('/projects', { method: 'POST', body: { ...form, managerId: form.managerId || undefined } }),
    onSuccess: () => { setOpen(false); setForm({ name: '', key: '', description: '', managerId: '' }); qc.invalidateQueries({ queryKey: ['projects'] }); },
  });
  if (error) return <Failure error={error} />;
  return (
    <Page title="Projects" action={me?.role === 'admin' && <button className="btn" onClick={() => setOpen(!open)}>New project</button>}>
      {open && (
        <form className="panel p-4 mb-5 grid md:grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div><label className="label" htmlFor="pn">Name</label><input id="pn" required className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="pk">Key (2 to 6 letters)</label><input id="pk" required className="field uppercase" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} /></div>
          <div><label className="label" htmlFor="pd">Description</label><input id="pd" className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><label className="label" htmlFor="pm">Project Manager</label>
            <select id="pm" className="field" value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
              <option value="">Assign later</option>{managers?.data.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
          {create.error && <p role="alert" className="md:col-span-2 text-sm font-semibold text-redpencil">{create.error.message}</p>}
          <div><button className="btn" disabled={create.isPending}>Create project</button></div>
        </form>
      )}
      {data?.data.length === 0 && <Empty>You are not on any projects yet. An Admin or Project Manager can add you.</Empty>}
      <ul className="panel divide-y divide-line">
        {data?.data.map((p: any) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}/tasks`} className="flex items-center gap-4 p-4 hover:bg-ground">
              <span className="mark">{p.key}</span>
              <span className="flex-1 min-w-0"><b className="font-bold block">{p.name}</b><span className="text-sm text-ink-2 block truncate">{p.description}</span></span>
              {p.status === 'archived' && <span className="text-xs font-bold border border-ink rounded px-1.5">Archived</span>}
              <span className="text-sm font-medium whitespace-nowrap">{p.doneCount} of {p.taskCount} done</span>
              <span className="text-sm text-ink-2 w-32 text-right hidden md:block">{p.myRole && ROLE_LABEL[p.myRole as keyof typeof ROLE_LABEL]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
