'use client';
import Link from 'next/link';
import { type Activity, ApiErr, describe, statusLabel, timeAgo } from '@/lib/api';

export const Page = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <main className="p-7 max-w-6xl">
    <div className="flex items-center justify-between gap-4 mb-5"><h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>{action}</div>
    {children}
  </main>
);

export const Mark = ({ v, className = '' }: { v: number; className?: string }) => <span className={`mark ${className}`} title={`Version ${v}`}>v{v}</span>;

export function Failure({ error }: { error: unknown }) {
  const gone = error instanceof ApiErr && error.status === 404;
  return (
    <div role="alert" className="p-7">
      <p className="font-bold text-redpencil">{gone ? 'This no longer exists, or you no longer have access to it.' : (error as Error).message}</p>
      <Link href="/projects" className="underline text-sm font-semibold">Back to projects</Link>
    </div>
  );
}

export const StatusTag = ({ s }: { s: string }) => <span className="text-xs font-bold border border-ink rounded px-1.5 py-0.5 whitespace-nowrap">{statusLabel(s)}</span>;

export const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-ink-2 py-6 text-sm">{children}</p>;

export function ActivityList({ items }: { items: Activity[] }) {
  if (!items.length) return <Empty>No activity yet.</Empty>;
  return (
    <ol className="divide-y divide-line">
      {items.map((a) => (
        <li key={a.id} className="flex justify-between gap-4 py-2.5 text-sm">
          <span><b className="font-bold">{a.actorName ?? 'Someone'}</b> {describe(a)}</span>
          <time className="text-ink-2 whitespace-nowrap" dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time>
        </li>
      ))}
    </ol>
  );
}
