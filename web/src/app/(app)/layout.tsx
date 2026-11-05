'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, FolderKanban, LayoutDashboard, LogOut, User, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api, ApiErr, ROLE_LABEL } from '@/lib/api';
import { LiveProvider, useLive, useMe } from '@/lib/providers';

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { connected, toast } = useLive();
  const { data: notes } = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api('/notifications?pageSize=1') });
  const { data: projects } = useQuery({ queryKey: ['projects', 'rail'], queryFn: () => api('/projects?status=active') });
  const nav = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/projects', label: 'Projects', icon: FolderKanban },
    { href: '/notifications', label: 'Notifications', icon: Bell, badge: notes?.unread },
    ...(me?.role === 'admin' ? [{ href: '/users', label: 'Users', icon: Users }] : []),
    { href: '/profile', label: 'Profile', icon: User },
  ];
  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    router.push('/login');
  }
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="bg-cover p-4 flex flex-col gap-1 md:sticky md:top-0 md:h-screen">
        <Link href="/dashboard" className="text-2xl font-extrabold tracking-tight px-2 mb-4">Lockstep</Link>
        <nav aria-label="Main" className="flex md:flex-col gap-1 overflow-x-auto">
          {nav.map(({ href, label, icon: Icon, badge }) => {
            const on = path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-md font-semibold text-[15px] whitespace-nowrap ${on ? 'bg-ink text-cover' : 'hover:bg-cover-deep'}`}>
                <Icon size={17} aria-hidden />{label}
                {!!badge && <span className="ml-auto bg-redpencil text-white text-xs font-bold rounded px-1.5" aria-label={`${badge} unread`}>{badge}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block mt-5 min-h-0 overflow-y-auto">
          <p className="text-xs font-bold px-2.5 mb-1">Active projects</p>
          {projects?.data.map((p: any) => (
            <Link key={p.id} href={`/projects/${p.id}/tasks`} className={`block px-2.5 py-1.5 rounded-md text-sm font-semibold truncate ${path.includes(p.id) ? 'bg-cover-deep' : 'hover:bg-cover-deep'}`}>{p.name}</Link>
          ))}
        </div>
        <div className="mt-auto pt-3 border-t-[1.5px] border-ink hidden md:block">
          <p className="text-sm font-bold px-1">{me?.name}</p>
          <p className="text-xs font-medium px-1">{me && ROLE_LABEL[me.role]}</p>
          <div className="flex items-center justify-between px-1 mt-2">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <i className={`size-2 rounded-full ${connected ? 'bg-pencil' : 'bg-redpencil'}`} />{connected ? 'Live' : 'Reconnecting…'}
            </span>
            <button onClick={logout} className="flex items-center gap-1 text-xs font-bold cursor-pointer hover:underline"><LogOut size={13} aria-hidden />Sign out</button>
          </div>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
      <div aria-live="polite" className="fixed bottom-4 right-4 z-50">
        {toast && <div className="bg-ink text-white text-sm font-semibold rounded-md px-4 py-3 max-w-sm shadow-[0_6px_20px_#15171c55]">{toast}</div>}
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, error, isLoading } = useMe();
  useEffect(() => { if (error instanceof ApiErr && error.status === 401) router.replace('/login'); }, [error, router]);
  if (isLoading) return <p className="p-8 text-ink-2">Loading…</p>;
  if (error && !(error instanceof ApiErr && error.status === 401)) return <p role="alert" className="p-8 text-redpencil font-semibold">{(error as Error).message}</p>;
  if (!data) return null;
  return <LiveProvider><Shell>{children}</Shell></LiveProvider>;
}
