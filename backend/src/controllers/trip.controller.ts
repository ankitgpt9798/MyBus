import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { BusAttrs } from '../models/Bus';
import { Operator, OperatorAttrs } from '../models/Operator';
import { Route, RouteAttrs } from '../models/Route';
import { Trip } from '../models/Trip';
import { Booking } from '../models/Booking';
import { REFUND_POLICY, expireStaleHolds } from '../services/booking.service';
import { badRequest, notFound } from '../utils/AppError';
import { DATE_RE, DepartureSlot, MINUTE_MS, departureSlot, istDayRange } from '../utils/time';
import { isObjectId } from '../utils/validate';
import { routeSummary, trustedReviewersOfRoute } from '../services/review.service';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactCi = (s: string) => new RegExp(`^${escapeRegex(s.trim())}$`, 'i');
const list = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

type RouteDoc = RouteAttrs & { _id: Types.ObjectId };

export const publicRoute = (r: RouteDoc) => ({
  id: String(r._id),
  from: r.from,
  to: r.to,
  code: r.code,
  distanceKm: r.distanceKm,
  durationMinutes: r.durationMinutes,
  ratingAvg: r.ratingAvg,
  ratingCount: r.ratingCount,
});

export async function listCities(_req: Request, res: Response) {
  const [from, to] = await Promise.all([Route.distinct('from'), Route.distinct('to')]);
  res.json({ cities: [...new Set([...from, ...to])].sort() });
}

export async function popularRoutes(_req: Request, res: Response) {
  const routes = await Route.find().sort({ ratingAvg: -1, distanceKm: 1 }).limit(8).lean<RouteDoc[]>();
  res.json({ routes: routes.map(publicRoute) });
}

export async function getRoute(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('ROUTE_NOT_FOUND');
  const route = await Route.findById(req.params.id).lean<RouteDoc>();
  if (!route) throw notFound('ROUTE_NOT_FOUND', 'Route not found');
  const upcoming = { route: route._id, status: 'scheduled' as const, departureTime: { $gt: new Date() } };
  const [upcomingTrips, operatorIds, next, trustedReviewers] = await Promise.all([
    Trip.countDocuments(upcoming),
    Trip.distinct('operator', upcoming),
    Trip.find(upcoming)
      .sort({ departureTime: 1 })
      .limit(5)
      .populate<{ bus: BusAttrs & { _id: Types.ObjectId } }>('bus', '-seats')
      .populate<{ operator: OperatorAttrs & { _id: Types.ObjectId } }>('operator', 'name')
      .lean(),
    trustedReviewersOfRoute(route._id),
  ]);
  const operators = await Operator.find({ _id: { $in: operatorIds } }).select('name').sort({ name: 1 }).lean();
  res.json({
    route: { ...publicRoute(route), stops: route.stops },
    upcomingTrips,
    operators: operators.map((o) => o.name),
    nextTrips: next.map((t) => ({
      id: String(t._id),
      departureTime: t.departureTime,
      arrivalTime: t.arrivalTime,
      fare: t.fare,
      operatorName: t.operator.name,
      busName: t.bus.name,
      busType: t.bus.type,
      ac: t.bus.ac,
      seatsAvailable: t.bus.totalSeats - t.bookedSeats.length,
    })),
    ratingSummary: routeSummary(route),
    trustedReviewers,
  });
}

export const MAX_SEATS_PER_BOOKING = 6;
const SORTS = ['price', 'departure', 'duration', 'seats'] as const;
const numOrNull = (v: unknown) => (v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function searchTrips(req: Request, res: Response) {
  const from = String(req.query.from ?? '').trim();
  const to = String(req.query.to ?? '').trim();
  const date = String(req.query.date ?? '');
  const errors = [];
  if (!from) errors.push({ field: 'from', rule: 'required' });
  if (!to) errors.push({ field: 'to', rule: 'required' });
  if (!DATE_RE.test(date) || Number.isNaN(new Date(date).getTime())) errors.push({ field: 'date', rule: 'date' });
  if (errors.length) throw badRequest('VALIDATION_ERROR', 'Invalid search', errors);
  if (from.toLowerCase() === to.toLowerCase()) throw badRequest('SEARCH_SAME_CITY', 'Origin and destination must differ');

  const route = await Route.findOne({ from: exactCi(from), to: exactCi(to) }).lean<RouteDoc>();
  if (!route) return res.json({ route: null, trips: [], meta: { total: 0, minFare: 0, maxFare: 0, operators: [] } });

  const { start, end } = istDayRange(date);
  const now = new Date();
  const trips = await Trip.find({
    route: route._id,
    status: 'scheduled',
    departureTime: { $gte: start > now ? start : now, $lt: end },
  })
    .populate<{ bus: BusAttrs & { _id: Types.ObjectId } }>('bus', '-seats')
    .populate<{ operator: OperatorAttrs & { _id: Types.ObjectId } }>('operator', 'name')
    .lean();

  let results = trips.map((trip) => ({
    id: String(trip._id),
    departureTime: trip.departureTime,
    arrivalTime: trip.arrivalTime,
    durationMinutes: Math.round((trip.arrivalTime.getTime() - trip.departureTime.getTime()) / MINUTE_MS),
    fare: trip.fare,
    seatsAvailable: trip.bus.totalSeats - trip.bookedSeats.length,
    totalSeats: trip.bus.totalSeats,
    slot: departureSlot(trip.departureTime),
    operator: { id: String(trip.operator._id), name: trip.operator.name },
    bus: { name: trip.bus.name, type: trip.bus.type, ac: trip.bus.ac, amenities: trip.bus.amenities },
  }));

  const fares = results.map((r) => r.fare);
  const meta = {
    total: results.length,
    minFare: fares.length ? Math.min(...fares) : 0,
    maxFare: fares.length ? Math.max(...fares) : 0,
    operators: [...new Map(results.map((r) => [r.operator.id, r.operator])).values()],
  };

  // Filters
  const busTypes = list(req.query.busType);
  const acFilter = list(req.query.ac); // 'ac', 'nonac'
  const slots = list(req.query.slots) as DepartureSlot[];
  const operators = list(req.query.operators);
  const minPrice = numOrNull(req.query.minPrice);
  const maxPrice = numOrNull(req.query.maxPrice);
  results = results.filter(
    (r) =>
      (!busTypes.length || busTypes.includes(r.bus.type)) &&
      (!acFilter.length || acFilter.includes(r.bus.ac ? 'ac' : 'nonac')) &&
      (!slots.length || slots.includes(r.slot)) &&
      (!operators.length || operators.includes(r.operator.id)) &&
      (minPrice === null || r.fare >= minPrice) &&
      (maxPrice === null || r.fare <= maxPrice),
  );

  // Sorting
  const sort = SORTS.includes(req.query.sort as (typeof SORTS)[number]) ? (req.query.sort as (typeof SORTS)[number]) : 'departure';
  const dir = req.query.order === 'desc' ? -1 : 1;
  const key = {
    price: (r: (typeof results)[number]) => r.fare,
    departure: (r: (typeof results)[number]) => r.departureTime.getTime(),
    duration: (r: (typeof results)[number]) => r.durationMinutes,
    seats: (r: (typeof results)[number]) => r.seatsAvailable,
  }[sort];
  results.sort((a, b) => (key(a) - key(b)) * dir);

  res.json({ route: publicRoute(route), trips: results, meta });
}

export async function getTrip(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('TRIP_NOT_FOUND', 'Trip not found');
  await expireStaleHolds();
  const trip = await Trip.findById(req.params.id)
    .populate<{ bus: BusAttrs & { _id: Types.ObjectId } }>('bus')
    .populate<{ operator: OperatorAttrs & { _id: Types.ObjectId } }>('operator', 'name')
    .populate<{ route: RouteDoc }>('route')
    .lean();
  if (!trip) throw notFound('TRIP_NOT_FOUND', 'Trip not found');
  // bookedSeats covers sold and held seats; heldSeats lists the ones only reserved by an unpaid hold.
  const heldSeats: string[] = await Booking.distinct('seats', { trip: trip._id, status: 'pending' });
  // Seats already booked for a female passenger, so women can choose to sit next to women. Gender only: no names.
  const femaleSeats = (
    await Booking.find({ trip: trip._id, status: { $in: ['pending', 'confirmed'] } }).select('passengers.seat passengers.gender').lean()
  ).flatMap((b) => b.passengers.filter((p) => p.gender === 'female').map((p) => p.seat));

  res.json({
    trip: {
      id: String(trip._id),
      departureTime: trip.departureTime,
      arrivalTime: trip.arrivalTime,
      durationMinutes: Math.round((trip.arrivalTime.getTime() - trip.departureTime.getTime()) / MINUTE_MS),
      fare: trip.fare,
      status: trip.status,
      bookable: trip.status === 'scheduled' && trip.departureTime > new Date(),
      bookedSeats: trip.bookedSeats,
      heldSeats,
      femaleSeats,
      seatsAvailable: trip.bus.totalSeats - trip.bookedSeats.length,
    },
    route: { ...publicRoute(trip.route), stops: trip.route.stops },
    operator: { id: String(trip.operator._id), name: trip.operator.name },
    bus: {
      name: trip.bus.name,
      type: trip.bus.type,
      ac: trip.bus.ac,
      amenities: trip.bus.amenities,
      totalSeats: trip.bus.totalSeats,
      seats: trip.bus.seats,
    },
    policy: { holdMinutes: env.seatHoldMinutes, maxSeats: MAX_SEATS_PER_BOOKING, refund: REFUND_POLICY },
  });
}

