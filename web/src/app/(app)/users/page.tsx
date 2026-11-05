'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityList, Failure, Page } from '@/components/ui';
import { api, ROLE_LABEL, type Role } from '@/lib/api';
import { useMe } from '@/lib/providers';

const ROLES = Object.keys(ROLE_LABEL) as Role[];

export default function Users() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'team_member' });
  const { data, error } = useQuery({ queryKey: ['users', 'all'], queryFn: () => api('/users?pageSize=200') });
  const { data: log } = useQuery({ queryKey: ['activity', 'system'], enabled: me?.role === 'admin', queryFn: () => api('/activity?pageSize=15') });
  const done = () => qc.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({ mutationFn: () => api('/users', { method: 'POST', body: form }), onSuccess: () => { setOpen(false); setForm({ name: '', email: '', password: '', role: 'team_member' }); done(); } });
  const patch = useMutation({ mutationFn: ({ id, ...body }: any) => api(`/users/${id}`, { method: 'PATCH', body }), onSuccess: done });
  if (error) return <Failure error={error} />;
  if (me?.role !== 'admin') return <p className="p-7 font-semibold">Only an Admin can manage users.</p>;
  return (
    <Page title="Users" action={<button className="btn" onClick={() => setOpen(!open)}>New user</button>}>
      {open && (
        <form className="panel p-4 mb-5 grid md:grid-cols-4 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div><label className="label" htmlFor="n">Name</label><input id="n" required className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="e">Email</label><input id="e" type="email" required className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label" htmlFor="pw">Password (8+ characters)</label><input id="pw" type="password" minLength={8} required autoComplete="new-password" className="field" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div><label className="label" htmlFor="r">Role</label><select id="r" className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          {create.error && <p role="alert" className="md:col-span-4 text-sm font-semibold text-redpencil">{create.error.message}</p>}
          <div><button className="btn" disabled={create.isPending}>Create user</button></div>
        </form>
      )}
      {patch.error && <p role="alert" className="text-sm font-semibold text-redpencil mb-3">{patch.error.message}</p>}
      <ul className="panel divide-y divide-line mb-7">
        {data?.data.map((u: any) => (
          <li key={u.id} className="flex items-center gap-3 p-3">
            <span className="flex-1 min-w-0"><b className="font-bold block">{u.name}{!u.isActive && ' (deactivated)'}</b><span className="text-sm text-ink-2">{u.email}</span></span>
            <select aria-label={`Role for ${u.name}`} className="field !w-44" value={u.role} disabled={u.id === me.id} onChange={(e) => patch.mutate({ id: u.id, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            <button className="btn btn-quiet" disabled={u.id === me.id} onClick={() => patch.mutate({ id: u.id, isActive: !u.isActive })}>{u.isActive ? 'Deactivate' : 'Reactivate'}</button>
          </li>
        ))}
      </ul>
      <h2 className="text-lg font-extrabold mb-2">System activity</h2>
      <div className="panel px-4">{log && <ActivityList items={log.data} />}</div>
    </Page>
  );
}
