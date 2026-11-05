import 'dotenv/config';
import { z } from 'zod';

export const env = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().default(4000),
}).parse(process.env);
