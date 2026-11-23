import { Types } from 'mongoose';
import { env } from '../config/env';
import { Booking, BookingAttrs, REMINDER_KINDS } from '../models/Booking';
import { bookingParams } from './notification.params';
import { notify } from './notification.service';

type ReminderKind = (typeof REMINDER_KINDS)[number];
type Reminder = { kind: ReminderKind; dueAt: Date; status: 'pending' | 'sent' | 'skipped'; sentAt?: Date | null };
type BookingLean = BookingAttrs & { _id: Types.ObjectId };

/** Lead time before departure per reminder kind (default 24 h and 2 h; compressed in tests). */
const LEAD_MS: Record<ReminderKind, number> = {
  '24h': env.reminders.leadsMs[0] ?? 24 * 3_600_000,
  '2h': env.reminders.leadsMs[1] ?? 2 * 3_600_000,
};

/**
 * Reminder schedule for a booking confirmed at `confirmedAt`: a reminder is due `lead` before departure and is
 * only kept if that moment was still ahead when the booking was made (a booking 10 h before departure gets the
 * 2 h reminder only).
 */
export function initialReminders(departure: Date, confirmedAt: Date): Reminder[] {
  return REMINDER_KINDS.map((kind) => {
    const dueAt = new Date(departure.getTime() - LEAD_MS[kind]);
    return { kind, dueAt, status: dueAt > confirmedAt ? 'pending' : 'skipped' };
  });
}

/**
 * After a reschedule: reminders not sent yet follow the new departure (and are skipped if their new time has
 * already passed). Reminders already sent stay sent; the traveller also gets the schedule-change alert.
 */
export function retimedReminders(existing: Reminder[] | undefined, departure: Date, now = new Date()): Reminder[] {
  return REMINDER_KINDS.map((kind) => {
    const prev = existing?.find((r) => r.kind === kind);
    if (prev?.status === 'sent') return prev;
    const dueAt = new Date(departure.getTime() - LEAD_MS[kind]);
    return { kind, dueAt, status: dueAt > now ? 'pending' : 'skipped' };
  });
}

/** Sets up reminders for a newly confirmed booking (no-op if it already has them). */
export async function scheduleReminders(bookingId: Types.ObjectId | string): Promise<void> {
  const b = await Booking.findById(bookingId).select('status journey.departureTime payment.paidAt reminders').lean<BookingLean>();
  if (!b || b.status !== 'confirmed' || b.reminders?.length) return;
  const reminders = initialReminders(new Date(b.journey.departureTime), b.payment?.paidAt ?? new Date());
  await Booking.updateOne({ _id: b._id, reminders: { $exists: false } }, { $set: { reminders } });
}

/** Re-times the reminders of every confirmed booking on a rescheduled trip. */
export async function retimeTripReminders(tripId: Types.ObjectId | string, departure: Date): Promise<number> {
  const bookings = await Booking.find({ trip: tripId, status: 'confirmed' }).select('reminders').lean<BookingLean[]>();
  for (const b of bookings) {
    await Booking.updateOne({ _id: b._id }, { $set: { reminders: retimedReminders(b.reminders as Reminder[] | undefined, departure) } });
  }
  return bookings.length;
}

/**
 * Scheduler tick. Sends each due reminder once per booking:
 *  - only confirmed bookings (cancelled / expired / completed get none)
 *  - if several are due at once (e.g. the server was down), only the latest is sent and the older one is skipped
 *  - the notification carries a dedupe key (booking + kind + due time), so a crash between sending and marking,
 *    a restart or an overlapping run never produces a duplicate
 */
export async function processReminders(now = new Date()): Promise<number> {
  // Bookings confirmed before reminders existed (or whose confirm event was missed) get a schedule first.
  const unscheduled = await Booking.find({ status: 'confirmed', 'journey.departureTime': { $gt: now }, reminders: { $exists: false } })
    .select('_id')
    .limit(200)
    .lean();
  for (const { _id } of unscheduled) await scheduleReminders(_id);

  const due = await Booking.find({ status: 'confirmed', reminders: { $elemMatch: { status: 'pending', dueAt: { $lte: now } } } })
    .limit(100)
    .lean<BookingLean[]>();
  let sent = 0;
  for (const b of due) {
    const reminders = (b.reminders ?? []) as Reminder[];
    const pending = reminders.filter((r) => r.status === 'pending' && r.dueAt <= now).sort((a, z) => z.dueAt.getTime() - a.dueAt.getTime());
    const departed = new Date(b.journey.departureTime) <= now;
    // After departure nothing is sent; otherwise only the most recent due reminder is.
    const latest = departed ? undefined : pending[0];
    for (const r of pending) if (r !== latest) await markReminder(b._id, r, 'skipped');
    if (!latest) continue;
    await notify(
      b.user,
      'journey_reminder',
      { ...bookingParams(b), reminderKind: latest.kind },
      { bookingId: b._id, pnr: b.pnr, emailTo: b.contact?.email, dedupeKey: `reminder:${b._id}:${latest.kind}:${latest.dueAt.toISOString()}` },
    );
    await markReminder(b._id, latest, 'sent');
    sent++;
  }
  return sent;
}

function markReminder(bookingId: Types.ObjectId, r: Reminder, status: 'sent' | 'skipped') {
  return Booking.updateOne(
    { _id: bookingId },
    { $set: { 'reminders.$[r].status': status, ...(status === 'sent' && { 'reminders.$[r].sentAt': new Date() }) } },
    { arrayFilters: [{ 'r.kind': r.kind, 'r.status': 'pending', 'r.dueAt': r.dueAt }] },
  );
}
