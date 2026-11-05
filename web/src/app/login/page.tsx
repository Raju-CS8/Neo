'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';

const DEMO = [['Admin', 'admin'], ['Project Manager', 'priya'], ['Team Member', 'dana'], ['Viewer', 'vera']];

export default function Login() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      qc.clear();
      router.push('/dashboard');
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <main className="min-h-screen grid md:grid-cols-[1fr_480px]">
      <section className="bg-cover p-10 flex flex-col justify-between">
        <p className="text-2xl font-extrabold tracking-tight">Lockstep</p>
        <div aria-hidden className="space-y-3 max-w-2xl">
          {[[12, 40, 71], [22, 55, 88], [8, 33, 64], [28, 60, 80]].map((row, i) => (
            <div key={i} className="stave"><div className="stave-bars" />{row.map((x) => <i key={x} className="note" style={{ left: `${x}%` }} />)}</div>
          ))}
        </div>
        <h1 className="text-5xl font-extrabold tracking-tight max-w-xl leading-[1.05]">One team, reading the same page.</h1>
      </section>
      <section className="flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <h2 className="text-2xl font-extrabold">Sign in</h2>
          <div><label className="label" htmlFor="email">Email</label><input id="email" className="field" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label" htmlFor="password">Password</label><input id="password" className="field" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <p role="alert" className="text-sm font-semibold text-redpencil">{error}</p>}
          <button className="btn w-full justify-center" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="pt-3 border-t border-line">
            <p className="text-sm text-ink-2 mb-2">Demo accounts (password <code>lockstep123</code>)</p>
            <div className="flex flex-wrap gap-2">
              {DEMO.map(([label, h]) => (
                <button key={h} type="button" className="btn btn-quiet !py-1 !px-2 !text-xs" onClick={() => { setEmail(`${h}@lockstep.test`); setPassword('lockstep123'); }}>{label}</button>
              ))}
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
