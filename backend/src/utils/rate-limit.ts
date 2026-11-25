/**
 * A small in-memory fixed-window counter (enough for one API process; no extra library).
 * allow(key, max, windowMs) is true while the key has been seen fewer than `max` times in the current window.
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    if (windows.size > 20_000) for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}
