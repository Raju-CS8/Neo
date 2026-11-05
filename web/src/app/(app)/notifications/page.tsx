'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Empty, Failure, Page } from '@/components/ui';
import { api, timeAgo } from '@/lib/api';

export default function Notifications() {
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api('/notifications') });
  const done = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: done });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: done });
  if (error) return <Failure error={error} />;
  return (
    <Page title="Notifications" action={!!data?.unread && <button className="btn btn-quiet" onClick={() => readAll.mutate()}>Mark all read</button>}>
      {data?.data.length === 0 && <Empty>You have no notifications.</Empty>}
      <ul className="panel divide-y divide-line">
        {data?.data.map((n: any) => (
          <li key={n.id} className={`flex items-center gap-3 p-3 text-sm ${n.readAt ? '' : 'bg-pencil-wash'}`}>
            {!n.readAt && <span className="text-xs font-bold text-pencil">New</span>}
            <Link href={n.taskId ? `/tasks/${n.taskId}` : n.projectId ? `/projects/${n.projectId}/tasks` : '#'} onClick={() => !n.readAt && read.mutate(n.id)} className={`flex-1 hover:underline ${n.readAt ? '' : 'font-bold'}`}>{n.message}</Link>
            <time className="text-ink-2 whitespace-nowrap">{timeAgo(n.createdAt)}</time>
            {!n.readAt && <button className="underline font-semibold cursor-pointer" onClick={() => read.mutate(n.id)}>Mark read</button>}
          </li>
        ))}
      </ul>
    </Page>
  );
}
