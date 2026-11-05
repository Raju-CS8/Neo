import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { env } from './env';
import { ApiError, errorHandler } from './http';
import { attachRealtime } from './realtime';
import { core } from './routes/core';
import { projectRoutes } from './routes/projects';
import { taskRoutes } from './routes/tasks';

export function buildServer() {
  const app = express();
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.get('/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api/v1/projects', projectRoutes);
  app.use('/api/v1', core); // holds the public auth routes, so it mounts before taskRoutes' requireAuth
  app.use('/api/v1', taskRoutes);
  app.use((_req, _res) => { throw new ApiError(404, 'NOT_FOUND', 'Route not found.'); });
  app.use(errorHandler);
  const server = createServer(app);
  attachRealtime(server);
  return { app, server };
}
