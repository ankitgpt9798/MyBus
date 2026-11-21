import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { Booking, BookingAttrs, GENDERS, PAYMENT_METHODS } from '../models/Booking';
import { BusAttrs } from '../models/Bus';
import { OperatorAttrs } from '../models/Operator';
import { RouteAttrs } from '../models/Route';
import { Trip } from '../models/Trip';
import {
  completeArrivedBookings,
  expireStaleHolds,
  generatePnr,
  refundQuote,
  releaseSeats,
} from '../services/booking.service';
import { appEvents } from '../services/events';
import { AppError, badRequest, conflict, notFound } from '../utils/AppError';
import { MINUTE_MS } from '../utils/time';
import { FieldError, Rule, isObjectId, validate } from '../utils/validate';
import { MAX_SEATS_PER_BOOKING } from './trip.controller';

/*
 * Booking flow:
 *   1. POST /bookings               hold seats (status "pending", expires after SEAT_HOLD_MINUTES)
 *   2. PUT  /bookings/:id/passengers  passenger + contact details for the held seats
 *   3. POST /bookings/:id/pay        mock payment -> "confirmed" with a PNR
 * A pending booking can be cancelled at any time to release its seats.
 */

export const PHONE_RE = /^\+?[0-9][0-9\s-]{8,14}$/;
type BookingDoc = BookingAttrs & { _id: Types.ObjectId; createdAt?: Date };

const pointWithTime = (p: { name: string; offsetMinutes: number }, departure: Date) => ({
  name: p.name,
  offsetMinutes: p.offsetMinutes,
  time: new Date(departure.getTime() + p.offsetMinutes * MINUTE_MS),
});

const hasDetails = (b: Pick<BookingAttrs, 'passengers' | 'seats' | 'contact'>) =>
  b.passengers.length === b.seats.length && !!b.contact?.email && !!b.contact?.phone;

export function publicBooking(b: BookingDoc) {
  const quote = b.status === 'confirmed' ? refundQuote(b.journey.departureTime, b.totalAmount) : null;
  return {
    id: String(b._id),
    pnr: b.pnr ?? null,
    status: b.status,
    tripId: String(b.trip),
    routeId: String(b.route),
    seats: b.seats,
    passengers: b.passengers,
    contact: { email: b.contact?.email ?? '', phone: b.contact?.phone ?? '' },
    detailsComplete: hasDetails(b),
    journey: b.journey,
    boardingPoint: pointWithTime(b.boardingPoint, b.journey.departureTime),
    droppingPoint: pointWithTime(b.droppingPoint, b.journey.departureTime),
    farePerSeat: b.farePerSeat,
    totalAmount: b.totalAmount,
    holdExpiresAt: b.status === 'pending' ? b.holdExpiresAt : null,
    payment: b.payment,
    cancellation: b.cancellation?.cancelledAt ? b.cancellation : null,
    cancellationQuote: quote,
    completedAt: b.completedAt ?? null,
    createdAt: b.createdAt,
  };
}

const PASSENGER_RULES: Record<string, Rule> = {
  seat: { type: 'string', required: true },
  name: { type: 'string', required: true, min: 2, max: 60 },
  age: { type: 'number', required: true, min: 1, max: 120 },
  gender: { type: 'string', required: true, enum: GENDERS },
};

/** Validates passengers (one per seat) and contact details; returns normalised values. */
function parseDetails(body: Record<string, any>, seats: string[]) {
  validate(body, {
    passengers: { type: 'array', required: true, min: 1, max: MAX_SEATS_PER_BOOKING },
    contact: { type: 'object', required: true },
  });
  const errors: FieldError[] = [];
  const collect = (prefix: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof AppError && Array.isArray(e.details)) {
        errors.push(...(e.details as FieldError[]).map((d) => ({ ...d, field: `${prefix}.${d.field}` })));
      } else throw e;
    }
  };
  collect('contact', () =>
    validate(body.contact, {
      email: { type: 'email', required: true, max: 120 },
      phone: { type: 'string', required: true, pattern: PHONE_RE },
    }),
  );
  (body.passengers as unknown[]).forEach((p, i) => collect(`passengers.${i}`, () => validate(p, PASSENGER_RULES)));
  if (errors.length) throw badRequest('VALIDATION_ERROR', 'Invalid input', errors);

  const bySeat = new Map((body.passengers as { seat: unknown }[]).map((p) => [String(p.seat), p as Record<string, any>]));
  if (bySeat.size !== seats.length || !seats.every((s) => bySeat.has(s))) {
    throw badRequest('PASSENGERS_MISMATCH', 'Provide exactly one passenger per selected seat');
  }
  return {
    passengers: seats.map((seat) => {
      const p = bySeat.get(seat)!;
      return { seat, name: String(p.name).trim(), age: Math.round(Number(p.age)), gender: p.gender };
    }),
    contact: { email: String(body.contact.email).trim(), phone: String(body.contact.phone).trim() },
  };
}

/** Step 1: hold seats. Passenger details may be sent now or later via PUT /bookings/:id/passengers. */
export async function createBooking(req: Request, res: Response) {
  validate(req.body, {
    tripId: { type: 'string', required: true },
    seats: { type: 'array', required: true, min: 1, max: MAX_SEATS_PER_BOOKING },
    boardingPoint: { type: 'string', required: true },
    droppingPoint: { type: 'string', required: true },
  });
  const { tripId, boardingPoint, droppingPoint } = req.body;
  const seats: string[] = req.body.seats.map(String);
  if (new Set(seats).size !== seats.length) throw badRequest('SEAT_DUPLICATE', 'Each seat can be selected once');
  const details = req.body.passengers !== undefined ? parseDetails(req.body, seats) : null;
  if (!isObjectId(tripId)) throw notFound('TRIP_NOT_FOUND', 'Trip not found');

  const trip = await Trip.findById(tripId)
    .populate<{ bus: BusAttrs }>('bus')
    .populate<{ operator: OperatorAttrs }>('operator', 'name')
    .populate<{ route: RouteAttrs & { _id: Types.ObjectId } }>('route');
  if (!trip) throw notFound('TRIP_NOT_FOUND', 'Trip not found');
  if (trip.status !== 'scheduled' || trip.departureTime <= new Date()) {
    throw conflict('TRIP_NOT_BOOKABLE', 'This trip is no longer available for booking');
  }
  const validSeats = new Set(trip.bus.seats.map((s) => s.number));
  if (!seats.every((s) => validSeats.has(s))) throw badRequest('SEAT_INVALID', 'Unknown seat number');

  const boarding = trip.route.stops.find((s) => s.type === 'boarding' && s.name === boardingPoint);
  const dropping = trip.route.stops.find((s) => s.type === 'dropping' && s.name === droppingPoint);
  if (!boarding) throw badRequest('VALIDATION_ERROR', 'Invalid boarding point', [{ field: 'boardingPoint', rule: 'enum' }]);
  if (!dropping) throw badRequest('VALIDATION_ERROR', 'Invalid dropping point', [{ field: 'droppingPoint', rule: 'enum' }]);

  // Free seats from expired holds, and drop this user's earlier unpaid hold on the same trip.
  await expireStaleHolds();
  const previous = await Booking.find({ user: req.user!._id, trip: trip._id, status: 'pending' });
  for (const p of previous) {
    const released = await Booking.updateOne(
      { _id: p._id, status: 'pending' },
      { $set: { status: 'cancelled', cancellation: { cancelledAt: new Date(), by: 'user', reason: 'replaced', refundPercent: 0, refundAmount: 0 } } },
    );
    if (released.modifiedCount) await releaseSeats(trip._id, p.seats);
  }

  // Atomic hold: succeeds only if none of the seats are already taken.
  const hold = await Trip.updateOne(
    { _id: trip._id, status: 'scheduled', bookedSeats: { $nin: seats } },
    { $push: { bookedSeats: { $each: seats } } },
  );
  if (hold.modifiedCount !== 1) {
    const fresh = await Trip.findById(trip._id).select('bookedSeats').lean();
    const taken = seats.filter((s) => fresh?.bookedSeats.includes(s));
    throw conflict('SEAT_UNAVAILABLE', 'Some selected seats were just booked by someone else', { seats: taken });
  }

  try {
    const booking = await Booking.create({
      user: req.user!._id,
      trip: trip._id,
      route: trip.route._id,
      status: 'pending',
      seats,
      passengers: details?.passengers ?? [],
      contact: details?.contact ?? { email: req.user!.email, phone: req.user!.phone || undefined },
      boardingPoint: { name: boarding.name, offsetMinutes: boarding.offsetMinutes },
      droppingPoint: { name: dropping.name, offsetMinutes: dropping.offsetMinutes },
      journey: {
        from: trip.route.from,
        to: trip.route.to,
        departureTime: trip.departureTime,
        arrivalTime: trip.arrivalTime,
        operatorName: trip.operator.name,
        busName: trip.bus.name,
        busType: trip.bus.type,
        ac: trip.bus.ac,
      },
      farePerSeat: trip.fare,
      totalAmount: trip.fare * seats.length,
      holdExpiresAt: new Date(Date.now() + env.seatHoldMinutes * MINUTE_MS),
      payment: { status: 'unpaid' },
    });
    res.status(201).json({ booking: publicBooking(booking.toObject()) });
  } catch (err) {
    await releaseSeats(trip._id, seats);
    throw err;
  }
}

async function findOwnBooking(req: Request) {
  if (!isObjectId(req.params.id)) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
  const booking = await Booking.findById(req.params.id);
  const isOwner = booking && String(booking.user) === String(req.user!._id);
  if (!booking || (!isOwner && req.user!.role !== 'admin')) throw notFound('BOOKING_NOT_FOUND', 'Booking not found');
  return booking;
}

/** Loads a booking the caller may pay for / edit, after expiring stale holds. */
async function findActiveHold(req: Request) {
  await expireStaleHolds();
  const booking = await findOwnBooking(req);
  if (booking.status === 'expired') throw conflict('BOOKING_EXPIRED', 'Seat hold expired, please select seats again');
  return booking;
}

/** Step 2: passenger and contact details for a held booking. */
export async function updateBookingDetails(req: Request, res: Response) {
  const booking = await findActiveHold(req);
  if (booking.status !== 'pending') throw conflict('BOOKING_NOT_PAYABLE', 'This booking can no longer be changed');
  const { passengers, contact } = parseDetails(req.body, booking.seats);
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'pending' },
    { $set: { passengers, contact } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('BOOKING_EXPIRED', 'Seat hold expired, please select seats again');
  res.json({ booking: publicBooking(updated.toObject()) });
}

/** Step 3: mock payment. `simulateFailure: true` exercises the failure path without touching the hold. */
export async function payBooking(req: Request, res: Response) {
  validate(req.body, {
    method: { type: 'string', required: true, enum: PAYMENT_METHODS },
    simulateFailure: { type: 'boolean' },
  });
  const booking = await findActiveHold(req);
  if (booking.status === 'confirmed') return res.json({ booking: publicBooking(booking.toObject()) });
  if (booking.status !== 'pending') throw conflict('BOOKING_NOT_PAYABLE', 'This booking cannot be paid');
  if (!hasDetails(booking)) throw badRequest('BOOKING_DETAILS_MISSING', 'Add passenger and contact details before paying');

  if (req.body.simulateFailure === true) {
    await Booking.updateOne({ _id: booking._id, status: 'pending' }, { $inc: { 'payment.failedAttempts': 1 } });
    throw new AppError(402, 'PAYMENT_FAILED', 'The payment was declined (demo)');
  }

  // Mock gateway: payment succeeds and returns a fake transaction id.
  const confirmed = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'pending' },
    {
      $set: {
        status: 'confirmed',
        pnr: generatePnr(),
        'payment.method': req.body.method,
        'payment.transactionId': 'TXN' + crypto.randomBytes(6).toString('hex').toUpperCase(),
        'payment.paidAt': new Date(),
        'payment.status': 'paid',
      },
      $unset: { holdExpiresAt: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!confirmed) throw conflict('BOOKING_EXPIRED', 'Seat hold expired, please select seats again');
  appEvents.emit('booking.confirmed', { bookingId: String(confirmed._id) });
  res.json({ booking: publicBooking(confirmed.toObject()) });
}

export async function cancelBooking(req: Request, res: Response) {
  validate(req.body ?? {}, { reason: { type: 'string', max: 300 } });
  const booking = await findOwnBooking(req);
  const by = String(booking.user) === String(req.user!._id) ? 'user' : 'admin';
  const reason = req.body?.reason ? String(req.body.reason).trim() : undefined;
  let update;
  if (booking.status === 'pending') {
    update = { refundPercent: 0, refundAmount: 0, paymentStatus: 'unpaid' };
  } else if (booking.status === 'confirmed') {
    const quote = refundQuote(booking.journey.departureTime, booking.totalAmount);
    if (!quote.allowed) throw conflict('BOOKING_NOT_CANCELLABLE', 'The bus has already departed');
    const paymentStatus = quote.refundPercent === 100 ? 'refunded' : quote.refundPercent > 0 ? 'partially_refunded' : 'paid';
    update = { refundPercent: quote.refundPercent, refundAmount: quote.refundAmount, paymentStatus };
  } else {
    throw conflict('BOOKING_NOT_CANCELLABLE', 'This booking can no longer be cancelled');
  }

  const cancelled = await Booking.findOneAndUpdate(
    { _id: booking._id, status: booking.status },
    {
      $set: {
        status: 'cancelled',
        'payment.status': update.paymentStatus,
        cancellation: {
          cancelledAt: new Date(),
          by,
          reason,
          refundPercent: update.refundPercent,
          refundAmount: update.refundAmount,
        },
      },
      $unset: { holdExpiresAt: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!cancelled) throw conflict('BOOKING_NOT_CANCELLABLE', 'This booking can no longer be cancelled');
  await releaseSeats(cancelled.trip, cancelled.seats);
  if (booking.status === 'confirmed') appEvents.emit('booking.cancelled', { bookingId: String(cancelled._id), by });
  res.json({ booking: publicBooking(cancelled.toObject()) });
}

export async function getBooking(req: Request, res: Response) {
  // Keep the status accurate on read: expire a lapsed hold, complete a finished journey.
  await expireStaleHolds();
  const booking = await findOwnBooking(req);
  await completeArrivedBookings(new Date(), { _id: booking._id });
  const fresh = await Booking.findById(booking._id).lean<BookingDoc>();
  res.json({ booking: publicBooking(fresh!) });
}

const TABS = {
  upcoming: { statuses: ['pending', 'confirmed'], sort: 1 },
  completed: { statuses: ['completed'], sort: -1 },
  cancelled: { statuses: ['cancelled', 'expired'], sort: -1 },
} as const;

export async function myBookings(req: Request, res: Response) {
  const tab = (req.query.tab as keyof typeof TABS) in TABS ? (req.query.tab as keyof typeof TABS) : 'upcoming';
  const userId = req.user!._id;
  await expireStaleHolds();
  await completeArrivedBookings(new Date(), { user: userId });
  const { statuses, sort } = TABS[tab];
  const filter: Record<string, unknown> = { user: userId, status: { $in: statuses } };
  // Seats replaced by a newer hold on the same trip are housekeeping, not something the user cancelled.
  if (tab === 'cancelled') filter['cancellation.reason'] = { $ne: 'replaced' };
  const bookings = await Booking.find(filter).sort({ 'journey.departureTime': sort }).limit(100).lean<BookingDoc[]>();
  res.json({ bookings: bookings.map(publicBooking) });
}
