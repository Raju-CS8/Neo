import type { ErrorRequestHandler } from 'express';
import { z, ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const forbidden = (msg = 'You do not have permission to do this.') => new ApiError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);

export const uuidParam = z.string().uuid();

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export const paged = <T>(data: T[], page: number, pageSize: number, total: number) => ({ data, meta: { page, pageSize, total } });

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  } else if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', details: err.flatten() } });
  } else if (err?.cause?.code === '23505' || err?.code === '23505') {
    res.status(409).json({ error: { code: 'DUPLICATE', message: 'That value is already in use.' } });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
  } else {
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
  }
};
