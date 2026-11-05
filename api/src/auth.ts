import { eq } from 'drizzle-orm';
import type { RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './db';
import { users } from './db/schema';
import { env } from './env';
import { ApiError, forbidden } from './http';

export type User = typeof users.$inferSelect;
export const COOKIE = 'lockstep_session';

declare global {
  namespace Express { interface Request { user: User } }
}

export const publicUser = ({ passwordHash: _omit, ...u }: User) => u;

export function setSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5 });
}

/** Returns the active user for a token, or null. Hits the DB so deactivation applies immediately. */
export async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, env.JWT_SECRET) as { sub: string };
    const [user] = await db.select().from(users).where(eq(users.id, sub));
    return user?.isActive ? user : null;
  } catch {
    return null;
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const user = await userFromToken(req.cookies?.[COOKIE]);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
  req.user = user;
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user.role !== 'admin') throw forbidden('Only an Admin can do this.');
  next();
};
