'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Page } from '@/components/ui';
import { api, ROLE_LABEL } from '@/lib/api';
import { useMe } from '@/lib/providers';

export default function Profile() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [name, setName] = useState(me?.name ?? '');
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const save = useMutation({
    mutationFn: () => api('/auth/me', { method: 'PATCH', body: { name, ...(newPassword && { currentPassword, newPassword }) } }),
    onSuccess: () => { setCurrent(''); setNew(''); qc.invalidateQueries({ queryKey: ['me'] }); },
  });
  return (
    <Page title="Profile">
      <form className="panel p-4 max-w-md space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <p className="text-sm">{me?.email} · {me && ROLE_LABEL[me.role]}</p>
        <div><label className="label" htmlFor="n">Name</label><input id="n" required className="field" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label" htmlFor="c">Current password</label><input id="c" type="password" autoComplete="current-password" className="field" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div><label className="label" htmlFor="w">New password (8+ characters)</label><input id="w" type="password" minLength={8} autoComplete="new-password" className="field" value={newPassword} onChange={(e) => setNew(e.target.value)} /></div>
        {save.error && <p role="alert" className="text-sm font-semibold text-redpencil">{save.error.message}</p>}
        {save.isSuccess && <p role="status" className="text-sm font-semibold text-pencil">Saved.</p>}
        <button className="btn" disabled={save.isPending}>Save</button>
      </form>
    </Page>
  );
}
