'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Failure } from '@/components/ui';
import { api, type Member, ROLE_LABEL } from '@/lib/api';
import { useMe } from '@/lib/providers';

export default function Team() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [pick, setPick] = useState({ userId: '', role: 'team_member' });
  const { data: project } = useQuery({ queryKey: ['project', id], queryFn: () => api(`/projects/${id}`).then((r) => r.data) });
  const { data: members, error } = useQuery({ queryKey: ['members', id], queryFn: () => api<{ data: Member[] }>(`/projects/${id}/members`).then((r) => r.data) });
  const manage = project?.status === 'active' && (project?.myRole === 'admin' || project?.myRole === 'project_manager');
  const isAdmin = me?.role === 'admin';
  const { data: users } = useQuery({ queryKey: ['users', 'directory'], enabled: !!manage, queryFn: () => api('/users?pageSize=200') });
  const done = () => qc.invalidateQueries({ queryKey: ['members', id] });
  const add = useMutation({ mutationFn: () => api(`/projects/${id}/members`, { method: 'POST', body: pick }), onSuccess: () => { setPick({ ...pick, userId: '' }); done(); } });
  const change = useMutation({ mutationFn: (v: { userId: string; role: string }) => api(`/projects/${id}/members/${v.userId}`, { method: 'PATCH', body: { role: v.role } }), onSuccess: done });
  const remove = useMutation({ mutationFn: (userId: string) => api(`/projects/${id}/members/${userId}`, { method: 'DELETE' }), onSuccess: done });
  if (error) return <Failure error={error} />;
  const fail = add.error ?? change.error ?? remove.error;
  const outsiders = users?.data.filter((u: any) => u.isActive && !members?.some((m) => m.userId === u.id)) ?? [];
  return (
    <div className="max-w-3xl">
      {manage && (
        <form className="panel p-3 mb-4 flex flex-wrap gap-3 items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="flex-1 min-w-48"><label className="label" htmlFor="au">Add person</label>
            <select id="au" required className="field" value={pick.userId} onChange={(e) => setPick({ ...pick, userId: e.target.value })}>
              <option value="">Choose…</option>{outsiders.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]})</option>)}
            </select></div>
          <div><label className="label" htmlFor="ar">Project role</label>
            <select id="ar" className="field" value={pick.role} onChange={(e) => setPick({ ...pick, role: e.target.value })}>
              {isAdmin && <option value="project_manager">Project Manager</option>}<option value="team_member">Team Member</option><option value="viewer">Viewer</option>
            </select></div>
          <button className="btn" disabled={add.isPending}>Add to team</button>
        </form>
      )}
      {fail && <p role="alert" className="text-sm font-semibold text-redpencil mb-3">{fail.message}</p>}
      <ul className="panel divide-y divide-line">
        {members?.map((m) => {
          const editable = manage && (isAdmin || m.role !== 'project_manager');
          return (
            <li key={m.userId} className="flex items-center gap-3 p-3">
              <span className="flex-1 min-w-0"><b className="font-bold block">{m.name}</b><span className="text-sm text-ink-2">{m.email}</span></span>
              {editable ? (
                <select aria-label={`Project role for ${m.name}`} className="field !w-44" value={m.role} onChange={(e) => change.mutate({ userId: m.userId, role: e.target.value })}>
                  {isAdmin && <option value="project_manager">Project Manager</option>}<option value="team_member">Team Member</option><option value="viewer">Viewer</option>
                </select>
              ) : <span className="text-sm font-medium">{ROLE_LABEL[m.role]}</span>}
              {editable && <button className="btn btn-quiet" onClick={() => remove.mutate(m.userId)}>Remove</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
