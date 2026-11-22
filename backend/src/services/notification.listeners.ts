import { Booking, BookingAttrs } from '../models/Booking';
import { appEvents } from './events';
import { notify } from './notification.service';
import { NotificationParams } from './notification.templates';

const MINUTE_MS = 60_000;

/** Raw (language-neutral) values describing a booking, stored with its notifications. */
function bookingParams(b: BookingAttrs & { _id: unknown }): NotificationParams {
  const dep = new Date(b.journey.departureTime);
  return {
    bookingId: String(b._id),
    pnr: b.pnr ?? undefined,
    from: b.journey.from,
    to: b.journey.to,
    departureTime: dep.toISOString(),
    seats: b.seats,
    ladiesSeats: b.ladiesSeats ?? [],
    boardingPoint: b.boardingPoint.name,
    boardingTime: new Date(dep.getTime() + b.boardingPoint.offsetMinutes * MINUTE_MS).toISOString(),
    amount: b.totalAmount,
  };
}

/** Subscribes the notification system to booking events. Called once at server start. */
export function registerNotificationListeners(): void {
  appEvents.on('booking.confirmed', async ({ bookingId }) => {
    const b = await Booking.findById(bookingId).lean<BookingAttrs & { _id: unknown }>();
    if (!b) return;
    await notify(b.user, 'booking_confirmed', bookingParams(b), { bookingId, pnr: b.pnr, emailTo: b.contact?.email });
  });

  // Covers both a traveller cancelling and an admin cancelling the whole trip (reason 'trip_cancelled').
  appEvents.on('booking.cancelled', async ({ bookingId }) => {
    const b = await Booking.findById(bookingId).lean<BookingAttrs & { _id: unknown }>();
    if (!b) return;
    await notify(
      b.user,
      'booking_cancelled',
      {
        ...bookingParams(b),
        refundAmount: b.cancellation?.refundAmount ?? 0,
        refundPercent: b.cancellation?.refundPercent ?? 0,
        paid: b.payment?.status !== 'unpaid',
        tripCancelled: b.cancellation?.reason === 'trip_cancelled',
      },
      { bookingId, pnr: b.pnr, emailTo: b.contact?.email },
    );
  });

  // 'trip.rescheduled' → 'schedule_changed' and journey reminders use the same notify() path; their
  // templates exist already and they are subscribed together with the schedule-change alerts.
}
