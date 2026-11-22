import type { Response } from 'express';
import { env } from '../config/env';

/**
 * Open Server-Sent Event streams per user (one per tab/device).
 * In-process only: fine for a single API instance.
 */
const streams = new Map<string, Set<Response>>();
export const HEARTBEAT_MS = env.notifications.streamHeartbeatMs;

export function addStream(userId: string, res: Response): void {
  let set = streams.get(userId);
  if (!set) streams.set(userId, (set = new Set()));
  set.add(res);
  // Keeps proxies from closing an idle connection, and lets the client notice a dead one
  // (a proxy can leave the browser's side open after the API goes away).
  const heartbeat = setInterval(() => res.write('event: ping\ndata: {}\n\n'), HEARTBEAT_MS);
  res.on('close', () => {
    clearInterval(heartbeat);
    set!.delete(res);
    if (!set!.size) streams.delete(userId);
  });
}

/** Sends a named event with JSON data to every open stream of the user. */
export function publish(userId: string, event: string, data: unknown): void {
  const set = streams.get(userId);
  if (!set) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(frame);
}

export const openStreamCount = (userId?: string) =>
  userId ? (streams.get(userId)?.size ?? 0) : [...streams.values()].reduce((n, s) => n + s.size, 0);
