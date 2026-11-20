import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Booking, BOOKING_STATUSES } from '../models/Booking';
import { Bus } from '../models/Bus';
import { Route } from '../models/Route';
import { Trip } from '../models/Trip';
import { User } from '../models/User';
import { cancelTripBookings, completeArrivedBookings } from '../services/booking.service';
import { appEvents } from '../services/events';
import { badRequest, conflict, notFound } from '../utils/AppError';
import { DATE_RE, MINUTE_MS, istDayRange } from '../utils/time';
import { isObjectId, validate } from '../utils/validate';
import { publicBooking } from './booking.controller';

const paging = (req: Request) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

export async function stats(_req: Request, res: Response) {
  await completeArrivedBookings();
  const now = new Date();
  const [users, upcomingTrips, byStatus, revenue] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    Trip.countDocuments({ status: 'scheduled', departureTime: { $gt: now } }),
    Booking.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Booking.aggregate<{ total: number }>([
      { $match: { 'payment.status': { $in: ['paid', 'partially_refunded', 'refunded'] } } },
      { $group: { _id: null, total: { $sum: { $subtract: ['$totalAmount', { $ifNull: ['$cancellation.refundAmount', 0] }] } } } },
    ]),
  ]);
  const bookings = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, 0]));
  for (const row of byStatus) bookings[row._id] = row.count;
  res.json({ users, upcomingTrips, bookings, revenue: revenue[0]?.total ?? 0 });
}

export async function listRoutes(_req: Request, res: Response) {
  const routes = await Route.find().sort({ from: 1, to: 1 }).select('from to code durationMinutes distanceKm').lean();
  res.json({ routes: routes.map((r) => ({ id: String(r._id), from: r.from, to: r.to, code: r.code, durationMinutes: r.durationMinutes, distanceKm: r.distanceKm })) });
}

export async function listBuses(_req: Request, res: Response) {
  const buses = await Bus.find().select('-seats').populate<{ operator: { name: string } }>('operator', 'name').sort({ name: 1 }).lean();
  res.json({
    buses: buses.map((b) => ({
      id: String(b._id),
      name: b.name,
      registrationNumber: b.registrationNumber,
      type: b.type,
      ac: b.ac,
      totalSeats: b.totalSeats,
      operatorName: b.operator.name,
    })),
  });
}

async function adminTripView(tripId: Types.ObjectId | string) {
  const t = await Trip.findById(tripId)
    .populate<{ route: { _id: Types.ObjectId; from: string; to: string; code: string } }>('route', 'from to code')
    .populate<{ bus: { name: string; type: string; ac: boolean; totalSeats: number; registrationNumber: string } }>(
      'bus',
      'name type ac totalSeats registrationNumber',
    )
    .populate<{ operator: { name: string } }>('operator', 'name')
    .lean();
  return t && toAdminTrip(t);
}

function toAdminTrip(t: any) {
  return {
    id: String(t._id),
    route: { id: String(t.route._id), from: t.route.from, to: t.route.to, code: t.route.code },
    bus: { name: t.bus.name, type: t.bus.type, ac: t.bus.ac, registrationNumber: t.bus.registrationNumber },
    operatorName: t.operator.name,
    departureTime: t.departureTime,
    arrivalTime: t.arrivalTime,
    fare: t.fare,
    status: t.status,
    seatsBooked: t.bookedSeats.length,
    totalSeats: t.bus.totalSeats,
  };
}

export async function listTrips(req: Request, res: Response) {
  const { page, limit, skip } = paging(req);
  const filter: Record<string, unknown> = {};
  const date = String(req.query.date ?? '');
  if (date) {
    if (!DATE_RE.test(date)) throw badRequest('VALIDATION_ERROR', 'Invalid date', [{ field: 'date', rule: 'date' }]);
    const { start, end } = istDayRange(date);
    filter.departureTime = { $gte: start, $lt: end };
  }
  if (isObjectId(req.query.routeId)) filter.route = req.query.routeId;
  if (req.query.status === 'scheduled' || req.query.status === 'cancelled') filter.status = req.query.status;

  const [total, trips] = await Promise.all([
    Trip.countDocuments(filter),
    Trip.find(filter)
      .sort({ departureTime: 1 })
      .skip(skip)
      .limit(limit)
      .populate('route', 'from to code')
      .populate('bus', 'name type ac totalSeats registrationNumber')
      .populate('operator', 'name')
      .lean(),
  ]);
  res.json({ trips: trips.map(toAdminTrip), total, page, limit });
}

export async function createTrip(req: Request, res: Response) {
  validate(req.body, {
    routeId: { type: 'string', required: true },
    busId: { type: 'string', required: true },
    departureTime: { type: 'date', required: true },
    arrivalTime: { type: 'date' },
    fare: { type: 'number', required: true, min: 1, max: 20000 },
  });
  const { routeId, busId, fare } = req.body;
  const [route, bus] = await Promise.all([
    isObjectId(routeId) ? Route.findById(routeId) : null,
    isObjectId(busId) ? Bus.findById(busId) : null,
  ]);
  if (!route) throw notFound('ROUTE_NOT_FOUND', 'Route not found');
  if (!bus) throw notFound('BUS_NOT_FOUND', 'Bus not found');
  const departureTime = new Date(req.body.departureTime);
  const arrivalTime = req.body.arrivalTime
    ? new Date(req.body.arrivalTime)
    : new Date(departureTime.getTime() + route.durationMinutes * MINUTE_MS);
  if (departureTime <= new Date()) throw badRequest('TRIP_DEPARTURE_PAST', 'Departure must be in the future');
  if (arrivalTime <= departureTime) throw badRequest('TRIP_ARRIVAL_BEFORE_DEPARTURE', 'Arrival must be after departure');

  const trip = await Trip.create({
    route: route._id,
    bus: bus._id,
    operator: bus.operator,
    departureTime,
    arrivalTime,
    fare: Math.round(fare),
  });
  res.status(201).json({ trip: await adminTripView(trip._id) });
}

export async function updateTrip(req: Request, res: Response) {
  validate(req.body, {
    departureTime: { type: 'date' },
    arrivalTime: { type: 'date' },
    fare: { type: 'number', min: 1, max: 20000 },
    status: { type: 'string', enum: ['cancelled'] },
  });
  if (!isObjectId(req.params.id)) throw notFound('TRIP_NOT_FOUND', 'Trip not found');
  const trip = await Trip.findById(req.params.id);
  if (!trip) throw notFound('TRIP_NOT_FOUND', 'Trip not found');
  if (trip.status === 'cancelled') throw conflict('TRIP_ALREADY_CANCELLED', 'This trip has been cancelled');

  if (req.body.status === 'cancelled') {
    trip.status = 'cancelled';
    await trip.save();
    const affected = await cancelTripBookings(trip._id);
    appEvents.emit('trip.cancelled', { tripId: String(trip._id) });
    return res.json({ trip: await adminTripView(trip._id), affectedBookings: affected });
  }

  const oldDepartureTime = trip.departureTime;
  const oldArrivalTime = trip.arrivalTime;
  const newDeparture = req.body.departureTime ? new Date(req.body.departureTime) : oldDepartureTime;
  // Moving the departure shifts the arrival by the same amount unless an explicit arrival is given.
  const newArrival = req.body.arrivalTime
    ? new Date(req.body.arrivalTime)
    : new Date(oldArrivalTime.getTime() + (newDeparture.getTime() - oldDepartureTime.getTime()));
  const scheduleChanged =
    newDeparture.getTime() !== oldDepartureTime.getTime() || newArrival.getTime() !== oldArrivalTime.getTime();

  if (scheduleChanged) {
    if (newDeparture <= new Date()) throw badRequest('TRIP_DEPARTURE_PAST', 'Departure must be in the future');
    if (newArrival <= newDeparture) throw badRequest('TRIP_ARRIVAL_BEFORE_DEPARTURE', 'Arrival must be after departure');
    trip.departureTime = newDeparture;
    trip.arrivalTime = newArrival;
  }
  // A fare change applies to new bookings only.
  if (req.body.fare !== undefined) trip.fare = Math.round(req.body.fare);
  await trip.save();

  let affected = 0;
  if (scheduleChanged) {
    const result = await Booking.updateMany(
      { trip: trip._id, status: { $in: ['pending', 'confirmed'] } },
      { $set: { 'journey.departureTime': newDeparture, 'journey.arrivalTime': newArrival } },
    );
    affected = result.modifiedCount;
    appEvents.emit('trip.rescheduled', {
      tripId: String(trip._id),
      oldDepartureTime,
      newDepartureTime: newDeparture,
      oldArrivalTime,
      newArrivalTime: newArrival,
    });
  }
  res.json({ trip: await adminTripView(trip._id), affectedBookings: affected });
}

export async function listBookings(req: Request, res: Response) {
  const { page, limit, skip } = paging(req);
  await completeArrivedBookings();
  const filter: Record<string, unknown> = {};
  if (BOOKING_STATUSES.includes(req.query.status as (typeof BOOKING_STATUSES)[number])) filter.status = req.query.status;
  const q = String(req.query.q ?? '').trim();
  if (q) {
    const users = await User.find({ email: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).select('_id').lean();
    filter.$or = [{ pnr: q.toUpperCase() }, { user: { $in: users.map((u) => u._id) } }];
  }
  if (isObjectId(req.query.tripId)) filter.trip = req.query.tripId;

  const [total, bookings] = await Promise.all([
    Booking.countDocuments(filter),
    Booking.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate<{ user: { _id: Types.ObjectId; name: string; email: string } }>('user', 'name email').lean(),
  ]);
  res.json({
    bookings: bookings.map((b) => ({
      ...publicBooking({ ...b, user: b.user._id }),
      user: { id: String(b.user._id), name: b.user.name, email: b.user.email },
    })),
    total,
    page,
    limit,
  });
}
