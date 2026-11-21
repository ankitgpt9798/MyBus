// Schedules are Indian, so calendar days are always IST (UTC+05:30), matching the API.
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD of the IST day containing `d` (+ `addDays`). */
export function istDate(d: Date = new Date(), addDays = 0): string {
  return new Date(d.getTime() + IST_OFFSET_MS + addDays * DAY_MS).toISOString().slice(0, 10);
}

/** Moves a YYYY-MM-DD date by `days`. */
export function shiftDate(date: string, days: number): string {
  return istDate(new Date(`${date}T12:00:00+05:30`), days);
}

export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Value for <input type="datetime-local">, shown in IST. */
export function toIstInput(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** Parses a datetime-local value as IST and returns an ISO timestamp. */
export function fromIstInput(value: string): string {
  return new Date(`${value}:00+05:30`).toISOString();
}
