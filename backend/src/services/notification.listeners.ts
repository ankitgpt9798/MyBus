import { Booking, BookingAttrs } from '../models/Booking';
import { appEvents } from './events';
import { bookingParams } from './notification.params';
import { notify } from './notification.service';
import { retimeTripReminders, scheduleReminders } from './reminder.service';

/** Subscribes the notification system to booking events. Called once at server start. */
export function registerNotificationListeners(): void {
  appEvents.on('booking.confirmed', async ({ bookingId }) => {
    const b = await Booking.findById(bookingId).lean<BookingAttrs & { _id: unknown }>();
    if (!b) return;
    await notify(b.user, 'booking_confirmed', bookingParams(b), { bookingId, pnr: b.pnr, emailTo: b.contact?.email });
    await scheduleReminders(bookingId);
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

  // An admin moved the departure/arrival (a fare-only edit emits nothing): alert every confirmed passenger
  // with old → new times, and move their pending journey reminders to the new departure.
  appEvents.on('trip.rescheduled', async ({ tripId, oldDepartureTime, oldArrivalTime, newDepartureTime }) => {
    await retimeTripReminders(tripId, newDepartureTime);
    const bookings = await Booking.find({ trip: tripId, status: 'confirmed' }).lean<(BookingAttrs & { _id: unknown })[]>();
    for (const b of bookings) {
      await notify(
        b.user,
        'schedule_changed',
        { ...bookingParams(b), oldDepartureTime: new Date(oldDepartureTime).toISOString(), oldArrivalTime: new Date(oldArrivalTime).toISOString() },
        { bookingId: String(b._id), pnr: b.pnr, emailTo: b.contact?.email },
      );
    }
  });
}
