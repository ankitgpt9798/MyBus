import { BookingAttrs } from '../models/Booking';
import { NotificationParams } from './notification.templates';

const MINUTE_MS = 60_000;

/** Raw (language-neutral) values describing a booking, stored with its notifications. */
export function bookingParams(b: BookingAttrs & { _id: unknown }): NotificationParams {
  const dep = new Date(b.journey.departureTime);
  return {
    bookingId: String(b._id),
    pnr: b.pnr ?? undefined,
    from: b.journey.from,
    to: b.journey.to,
    departureTime: dep.toISOString(),
    arrivalTime: new Date(b.journey.arrivalTime).toISOString(),
    seats: b.seats,
    ladiesSeats: b.ladiesSeats ?? [],
    boardingPoint: b.boardingPoint.name,
    boardingTime: new Date(dep.getTime() + b.boardingPoint.offsetMinutes * MINUTE_MS).toISOString(),
    amount: b.totalAmount,
  };
}
