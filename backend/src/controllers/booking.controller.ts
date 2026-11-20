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

export const PHONE_RE = /^\+?[0-9][0-9\s-]{8,14}$/;
type BookingDoc = BookingAttrs & { _id: Types.ObjectId; createdAt?: Date };

const pointWithTime = (p: { name: string; offsetMinutes: number }, departure: Date) => ({
  name: p.name,
  offsetMinutes: p.offsetMinutes,
  time: new Date(departure.getTime() + p.offsetMinutes * MINUTE_MS),
});

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
    contact: b.contact,
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

function validateBookingBody(body: Record<string, any>) {
  validate(body, {
    tripId: { type: 'string', required: true },
    seats: { type: 'array', required: true, min: 1, max: MAX_SEATS_PER_BOOKING },
    passengers: { type: 'array', required: true, min: 1, max: MAX_SEATS_PER_BOOKING },
    contact: { type: 'object', required: true },
    boardingPoint: { type: 'string', required: true },
    droppingPoint: { type: 'string', required: true },
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

  const seats: string[] = body.seats.map(String);
  if (new Set(seats).size !== seats.length) throw badRequest('SEAT_DUPLICATE', 'Each seat can be selected once');
  const passengerSeats = (body.passengers as { seat: string }[]).map((p) => String(p.seat));
  if (passengerSeats.length !== seats.length || !seats.every((s) => passengerSeats.includes(s))) {
    throw badRequest('PASSENGERS_MISMATCH', 'Provide exactly one passenger per selected seat');
  }
  return seats;
}

export async function createBooking(req: Request, res: Response) {
  const seats = validateBookingBody(req.body);
  const { tripId, passengers, contact, boardingPoint, droppingPoint } = req.body;
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
    p.status = 'cancelled';
    p.cancellation = { cancelledAt: new Date(), by: 'user', reason: 'replaced', refundPercent: 0, refundAmount: 0 };
    await p.save();
    await releaseSeats(trip._id, p.seats);
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
      passengers: seats.map((seat) => {
        const p = passengers.find((x: { seat: string }) => String(x.seat) === seat);
        return { seat, name: String(p.name).trim(), age: Math.round(Number(p.age)), gender: p.gender };
      }),
      contact: { email: String(contact.email).trim(), phone: String(contact.phone).trim() },
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

export async function payBooking(req: Request, res: Response) {
  validate(req.body, { method: { type: 'string', required: true, enum: PAYMENT_METHODS } });
  const booking = await findOwnBooking(req);
  if (booking.status === 'confirmed') return res.json({ booking: publicBooking(booking.toObject()) });
  if (booking.status === 'expired' || (booking.status === 'pending' && booking.holdExpiresAt! <= new Date())) {
    await expireStaleHolds();
    throw conflict('BOOKING_EXPIRED', 'Seat hold expired, please select seats again');
  }
  if (booking.status !== 'pending') throw conflict('BOOKING_NOT_PAYABLE', 'This booking cannot be paid');

  // Mock gateway: payment always succeeds and returns a fake transaction id.
  const confirmed = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'pending' },
    {
      $set: {
        status: 'confirmed',
        pnr: generatePnr(),
        payment: {
          method: req.body.method,
          transactionId: 'TXN' + crypto.randomBytes(6).toString('hex').toUpperCase(),
          paidAt: new Date(),
          status: 'paid',
        },
      },
      $unset: { holdExpiresAt: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!confirmed) throw conflict('BOOKING_NOT_PAYABLE', 'This booking cannot be paid');
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
  const bookings = await Booking.find({ user: userId, status: { $in: statuses } })
    .sort({ 'journey.departureTime': sort })
    .limit(100)
    .lean<BookingDoc[]>();
  res.json({ bookings: bookings.map(publicBooking) });
}
