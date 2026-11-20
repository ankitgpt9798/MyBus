// All schedules are for Indian cities, so calendar days and departure slots use IST (UTC+05:30).
export const IST_OFFSET_MS = 330 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** [start, end) of an IST calendar day given as YYYY-MM-DD. */
export function istDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + 24 * HOUR_MS) };
}

export const istHour = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();

/** Builds a Date for an IST day (YYYY-MM-DD) at the given IST hour/minute. */
export const istDateTime = (date: string, hour: number, minute: number) =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`);

/** YYYY-MM-DD for the IST day of `d`. */
export const istDateString = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export type DepartureSlot = 'night' | 'morning' | 'afternoon' | 'evening';
export function departureSlot(d: Date): DepartureSlot {
  const h = istHour(d);
  if (h < 6) return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}
