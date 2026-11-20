import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { Booking } from '../models/Booking';
import { Trip } from '../models/Trip';
import { HOUR_MS } from '../utils/time';
import { appEvents } from './events';

/**
 * Cancellation policy (hours before departure -> refund %):
 *   >= 24h: 90%   |   6h – 24h: 50%   |   < 6h: no refund   |   after departure: not cancellable
 */
export const REFUND_POLICY = [
  { minHours: 24, percent: 90 },
  { minHours: 6, percent: 50 },
  { minHours: 0, percent: 0 },
] as const;

export function refundQuote(departureTime: Date, totalAmount: number, now = new Date()) {
  const hoursLeft = (departureTime.getTime() - now.getTime()) / HOUR_MS;
  if (hoursLeft <= 0) return { allowed: false, refundPercent: 0, refundAmount: 0 };
  const tier = REFUND_POLICY.find((p) => hoursLeft >= p.minHours)!;
  return { allowed: true, refundPercent: tier.percent, refundAmount: Math.round((totalAmount * tier.percent) / 100) };
}

export async function releaseSeats(tripId: Types.ObjectId | string, seats: string[]): Promise<void> {
  if (seats.length) await Trip.updateOne({ _id: tripId }, { $pullAll: { bookedSeats: seats } });
}

const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generatePnr(): string {
  const bytes = crypto.randomBytes(8);
  return 'MB' + Array.from(bytes, (b) => PNR_ALPHABET[b % PNR_ALPHABET.length]).join('');
}

/** Releases seats of pending bookings whose payment window has passed. */
export async function expireStaleHolds(now = new Date()): Promise<number> {
  const stale = await Booking.find({ status: 'pending', holdExpiresAt: { $lte: now } }).select('_id trip seats');
  for (const b of stale) {
    const res = await Booking.updateOne({ _id: b._id, status: 'pending' }, { status: 'expired' });
    if (res.modifiedCount) await releaseSeats(b.trip, b.seats);
  }
  return stale.length;
}

/** Marks confirmed bookings as completed once the trip has arrived. */
export async function completeArrivedBookings(now = new Date(), filter: Record<string, unknown> = {}): Promise<number> {
  const res = await Booking.updateMany(
    { ...filter, status: 'confirmed', 'journey.arrivalTime': { $lte: now } },
    { $set: { status: 'completed', completedAt: now } },
  );
  return res.modifiedCount;
}

/** Cancels every active booking of a trip with a full refund (used when the operator/admin cancels the trip). */
export async function cancelTripBookings(tripId: Types.ObjectId | string): Promise<number> {
  const bookings = await Booking.find({ trip: tripId, status: { $in: ['pending', 'confirmed'] } });
  for (const b of bookings) {
    const paid = b.status === 'confirmed';
    b.status = 'cancelled';
    b.cancellation = {
      cancelledAt: new Date(),
      by: 'admin',
      reason: 'trip_cancelled',
      refundPercent: paid ? 100 : 0,
      refundAmount: paid ? b.totalAmount : 0,
    };
    if (paid) b.payment!.status = 'refunded';
    await b.save();
    await releaseSeats(b.trip, b.seats);
    appEvents.emit('booking.cancelled', { bookingId: String(b._id), by: 'admin' });
  }
  return bookings.length;
}
