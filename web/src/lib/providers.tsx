'use client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL, ApiErr, type Me } from './api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiErr && e.status >= 400 && e.status < 500) && n < 2, refetchOnWindowFocus: false } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<{ data: Me }>('/auth/me').then((r) => r.data) });

type Live = { connected: boolean; toast: string | null; say: (m: string) => void };
const LiveCtx = createContext<Live>({ connected: false, toast: null, say: () => {} });
export const useLive = () => useContext(LiveCtx);

/** One socket per signed-in tab. Server events only invalidate queries, so REST stays the source of truth. */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const socket = io(API_URL, { withCredentials: true });
    const inv = (...key: unknown[]) => qc.invalidateQueries({ queryKey: key });
    let everConnected = false;
    socket.on('connect', () => {
      setConnected(true);
      if (everConnected) qc.invalidateQueries(); // catch up on anything missed while offline
      everConnected = true;
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('event', ({ type, projectId, data }: { type: string; projectId: string | null; data: any }) => {
      if (type.startsWith('task.')) {
        inv('tasks', projectId); inv('task', data.id); inv('dashboard'); inv('projects');
      } else if (type.startsWith('comment.')) {
        inv('comments', data.taskId);
      } else if (type === 'activity.created') {
        inv('activity', projectId); inv('activity', 'system'); inv('dashboard');
      } else if (type === 'member.changed') {
        inv('members', projectId); inv('project', projectId); inv('projects'); inv('tasks', projectId);
      } else if (type.startsWith('project.')) {
        inv('project', projectId); inv('projects');
      }
    });
    socket.on('notification', (n: { message: string }) => {
      inv('notifications'); inv('projects'); inv('dashboard');
      setToast(n.message);
    });
    return () => { socket.close(); };
  }, [qc]);

  return <LiveCtx.Provider value={{ connected, toast, say: setToast }}>{children}</LiveCtx.Provider>;
}
