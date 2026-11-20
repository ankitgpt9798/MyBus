import crypto from 'node:crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  sub: string;
  role: string;
  jti: string;
  exp: number;
}

export function signAccessToken(userId: string, role: string): string {
  return jwt.sign({ role }, env.jwtSecret, {
    subject: userId,
    jwtid: crypto.randomUUID(),
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

/** Random URL-safe token plus its SHA-256 hash (only the hash is stored). */
export function createOpaqueToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
