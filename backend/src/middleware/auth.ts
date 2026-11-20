import type { NextFunction, Request, Response } from 'express';
import { RevokedToken } from '../models/RevokedToken';
import { User } from '../models/User';
import { verifyAccessToken } from '../services/token.service';
import { forbidden, unauthorized } from '../utils/AppError';

async function authenticate(req: Request): Promise<void> {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return;

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw unauthorized('AUTH_TOKEN_INVALID', 'Session expired or invalid token');
  }
  if (await RevokedToken.exists({ jti: payload.jti })) {
    throw unauthorized('AUTH_TOKEN_INVALID', 'Session has been logged out');
  }
  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized('AUTH_TOKEN_INVALID', 'Account no longer exists');
  req.user = user;
  req.auth = { jti: payload.jti, exp: payload.exp };
}

/** Attaches req.user when a valid token is present, but never rejects anonymous requests. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    await authenticate(req);
  } catch {
    req.user = undefined;
  }
  next();
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  await authenticate(req);
  if (!req.user) throw unauthorized();
  next();
}

/** Use after requireAuth on any route that needs a verified email (posting content, reviews, ...). */
export function requireVerified(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  if (!req.user.emailVerified) throw forbidden('AUTH_EMAIL_NOT_VERIFIED', 'Please verify your email first');
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  if (req.user.role !== 'admin') throw forbidden('AUTH_ADMIN_ONLY', 'Admin access required');
  next();
}
