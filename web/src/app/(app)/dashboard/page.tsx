'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ActivityList, Empty, Failure, Mark, Page, StatusTag } from '@/components/ui';
import { api, STATUSES } from '@/lib/api';
import { useMe } from '@/lib/providers';

export default function Dashboard() {
  const { data: me } = useMe();
  const { data, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => api('/dashboard').then((r) => r.data) });
  if (error) return <Failure error={error} />;
  if (!data) return <p className="p-7 text-ink-2">Loading…</p>;
  const total = STATUSES.reduce((n, s) => n + (data.byStatus[s.id] ?? 0), 0);
  return (
    <Page title={`Good to see you, ${me?.name.split(' ')[0]}`}>
      <section aria-label="Tasks by status" className="panel p-4 mb-6">
        <p className="text-sm font-semibold mb-3">{total} tasks across {data.projectCount} active {data.projectCount === 1 ? 'project' : 'projects'}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {STATUSES.map((s) => (
            <div key={s.id}><p className="text-3xl font-extrabold">{data.byStatus[s.id] ?? 0}</p><p className="text-sm font-medium text-ink-2">{s.label}</p></div>
          ))}
        </div>
      </section>
      <div className="grid lg:grid-cols-2 gap-6">
        <section>
          <h2 className="text-lg font-extrabold mb-2">Your open tasks</h2>
          <div className="panel px-4">
            {data.myTasks.length === 0 && <Empty>Nothing is assigned to you right now.</Empty>}
            <ul className="divide-y divide-line">
              {data.myTasks.map((t: any) => (
                <li key={t.id} className="py-2.5 flex items-center gap-3">
                  <Link href={`/tasks/${t.id}`} className="font-semibold text-sm hover:underline flex-1 min-w-0 truncate">{t.code} · {t.title}</Link>
                  <StatusTag s={t.status} /><Mark v={t.version} />
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section>
          <h2 className="text-lg font-extrabold mb-2">Latest activity</h2>
          <div className="panel px-4"><ActivityList items={data.recent} /></div>
        </section>
      </div>
    </Page>
  );
}
