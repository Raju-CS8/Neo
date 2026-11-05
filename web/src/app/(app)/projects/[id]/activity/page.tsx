'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ActivityList, Failure } from '@/components/ui';
import { api } from '@/lib/api';

export default function ProjectActivity() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const { data, error } = useQuery({ queryKey: ['activity', id, page], queryFn: () => api(`/projects/${id}/activity?page=${page}&pageSize=25`) });
  if (error) return <Failure error={error} />;
  if (!data) return null;
  return (
    <div className="max-w-3xl">
      <div className="panel px-4"><ActivityList items={data.data} /></div>
      <div className="flex gap-2 mt-3 items-center text-sm">
        <button className="btn btn-quiet" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</button>
        <button className="btn btn-quiet" disabled={page * 25 >= data.meta.total} onClick={() => setPage(page + 1)}>Older</button>
        <span className="text-ink-2">{data.meta.total} entries</span>
      </div>
    </div>
  );
}
