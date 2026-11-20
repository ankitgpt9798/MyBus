/**
 * Resets the catalogue (operators, buses, routes, trips, bookings) and upserts the admin + demo users.
 * Run with: npm run seed
 */
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { Booking } from '../models/Booking';
import { Bus } from '../models/Bus';
import { Operator } from '../models/Operator';
import { RevokedToken } from '../models/RevokedToken';
import { Route } from '../models/Route';
import { Trip } from '../models/Trip';
import { User } from '../models/User';
import { generatePnr } from '../services/booking.service';
import { HOUR_MS, MINUTE_MS, istDateString, istDateTime } from '../utils/time';
import {
  BUS_MODELS,
  CITY_CODES,
  CITY_POINTS,
  FARE_PER_KM,
  LONG_DEPARTURES,
  OPERATORS,
  ROUTE_PAIRS,
  SHORT_DEPARTURES,
} from './data';

const DAYS_BACK = 6;
const DAYS_AHEAD = 14;

export const DEMO_USERS = {
  traveler: { name: 'Riya Sharma', email: 'traveler@mybus.local', password: 'Traveler@123', emailVerified: true },
  unverified: { name: 'Arjun Mehta', email: 'unverified@mybus.local', password: 'Traveler@123', emailVerified: false },
};

// Deterministic PRNG so every seed run produces the same catalogue.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261120);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

type SeatDef = { number: string; deck: 'lower' | 'upper'; row: number; col: number; kind: 'seater' | 'sleeper' };

function buildSeats(type: 'seater' | 'sleeper'): SeatDef[] {
  const seats: SeatDef[] = [];
  if (type === 'seater') {
    // 2+2 layout, 10 rows, aisle at column 2.
    let n = 1;
    for (let row = 0; row < 10; row++) {
      for (const col of [0, 1, 3, 4]) seats.push({ number: String(n++), deck: 'lower', row, col, kind: 'seater' });
    }
  } else {
    // 2+1 sleeper on two decks, 6 rows each: single berth at column 0, aisle at 1, double at 2-3.
    for (const deck of ['lower', 'upper'] as const) {
      let n = 1;
      const prefix = deck === 'lower' ? 'L' : 'U';
      for (let row = 0; row < 6; row++) {
        for (const col of [0, 2, 3]) seats.push({ number: `${prefix}${n++}`, deck, row, col, kind: 'sleeper' });
      }
    }
  }
  return seats;
}

function buildStops(from: string, to: string, durationMinutes: number, via: string[]) {
  const boarding = CITY_POINTS[from].slice(0, 3).map((name, i) => ({ name: `${name}, ${from}`, type: 'boarding', offsetMinutes: i * 15 }));
  const viaStops = via.map((name, i) => ({
    name,
    type: 'via',
    offsetMinutes: Math.round(((i + 1) * durationMinutes) / (via.length + 1) / 5) * 5,
  }));
  const drops = CITY_POINTS[to].slice(0, 3);
  const dropping = drops.map((name, i) => ({
    name: `${name}, ${to}`,
    type: 'dropping',
    offsetMinutes: durationMinutes - (drops.length - 1 - i) * 15,
  }));
  return [...boarding, ...viaStops, ...dropping];
}

function fareFor(distanceKm: number, type: 'seater' | 'sleeper', ac: boolean) {
  const base = distanceKm * FARE_PER_KM[type][ac ? 'ac' : 'nonac'] * (0.9 + rand() * 0.25);
  return Math.max(199, Math.round(base / 10) * 10 - 1);
}

async function upsertUser(data: { name: string; email: string; password: string; emailVerified: boolean; role?: 'user' | 'admin' }) {
  const passwordHash = await bcrypt.hash(data.password, 10);
  return User.findOneAndUpdate(
    { email: data.email },
    {
      $set: { name: data.name, passwordHash, emailVerified: data.emailVerified, role: data.role ?? 'user' },
      $setOnInsert: { language: 'en', theme: 'light' },
    },
    { upsert: true, returnDocument: 'after' },
  );
}

async function main() {
  await connectDb();
  const models = [User, RevokedToken, Operator, Bus, Route, Trip, Booking];
  for (const m of models) await m.syncIndexes();

  console.log('[seed] clearing catalogue and bookings…');
  await Promise.all([Booking.deleteMany({}), Trip.deleteMany({}), Route.deleteMany({}), Bus.deleteMany({}), Operator.deleteMany({})]);

  // Users
  const admin = await upsertUser({ name: env.admin.name, email: env.admin.email, password: env.admin.password, emailVerified: true, role: 'admin' });
  const traveler = await upsertUser(DEMO_USERS.traveler);
  await upsertUser(DEMO_USERS.unverified);

  // Operators & buses (3 buses per operator)
  const operators = await Operator.insertMany(OPERATORS);
  const busDocs = operators.flatMap((op, i) =>
    [0, 1, 2].map((k) => {
      const model = BUS_MODELS[(i + k * 2) % BUS_MODELS.length];
      const seats = buildSeats(model.type);
      return {
        operator: op._id,
        name: model.name,
        registrationNumber: `MH${String(10 + i).padStart(2, '0')}-${String.fromCharCode(65 + k)}${String.fromCharCode(66 + i)}-${4100 + i * 10 + k}`,
        type: model.type,
        ac: model.ac,
        amenities: [...model.amenities],
        seats,
        totalSeats: seats.length,
      };
    }),
  );
  const buses = await Bus.insertMany(busDocs);

  // Routes in both directions
  const routeDocs = ROUTE_PAIRS.flatMap(([a, b, km, mins, via]) =>
    [
      [a, b, via],
      [b, a, [...via].reverse()],
    ].map(([from, to, stops]) => ({
      from: from as string,
      to: to as string,
      code: `${CITY_CODES[from as string]}-${CITY_CODES[to as string]}`,
      distanceKm: km,
      durationMinutes: mins,
      stops: buildStops(from as string, to as string, mins, stops as string[]),
    })),
  );
  const routes = await Route.insertMany(routeDocs);

  // Trips for every route over the date window
  const now = Date.now();
  const tripDocs = [];
  for (const route of routes) {
    const departures = route.durationMinutes > 360 ? LONG_DEPARTURES : SHORT_DEPARTURES;
    for (let d = -DAYS_BACK; d <= DAYS_AHEAD; d++) {
      const day = istDateString(new Date(now + d * 24 * HOUR_MS));
      for (const [h, m] of departures) {
        const bus = pick(buses);
        // Small per-trip jitter so operators don't all leave at the same minute.
        const departureTime = new Date(istDateTime(day, h, m).getTime() + Math.round(rand() * 4 - 2) * 5 * MINUTE_MS);
        const durationMinutes = route.durationMinutes + Math.round((rand() * 40 - 20) / 5) * 5;
        const future = departureTime.getTime() > now;
        // Some seats are already sold on future trips so the seat map looks realistic.
        const occupancy = future ? rand() * 0.55 : 0;
        const bookedSeats = bus.seats.filter(() => rand() < occupancy).map((s) => s.number);
        tripDocs.push({
          _id: new Types.ObjectId(),
          route: route._id,
          bus: bus._id,
          operator: bus.operator,
          departureTime,
          arrivalTime: new Date(departureTime.getTime() + durationMinutes * MINUTE_MS),
          fare: fareFor(route.distanceKm, bus.type as 'seater' | 'sleeper', bus.ac),
          bookedSeats,
        });
      }
    }
  }
  await Trip.insertMany(tripDocs);

  // Demo bookings for the traveler: three completed journeys (for reviews later) and one upcoming trip.
  const busById = new Map(buses.map((b) => [String(b._id), b]));
  const routeById = new Map(routes.map((r) => [String(r._id), r]));
  const opById = new Map(operators.map((o) => [String(o._id), o]));
  const pastTrips = tripDocs.filter((t) => t.arrivalTime.getTime() < now - 2 * HOUR_MS);
  const futureTrips = tripDocs.filter((t) => t.departureTime.getTime() > now + 3 * 24 * HOUR_MS);
  const chosen = [
    ...[0, 1, 2].map((i) => ({ trip: pastTrips[Math.floor((i + 0.5) * (pastTrips.length / 3))], status: 'completed' as const })),
    { trip: futureTrips[Math.floor(futureTrips.length / 5)], status: 'confirmed' as const },
  ];
  for (const { trip, status } of chosen) {
    const bus = busById.get(String(trip.bus))!;
    const route = routeById.get(String(trip.route))!;
    const seat = bus.seats.find((s) => !trip.bookedSeats.includes(s.number))!.number;
    await Trip.updateOne({ _id: trip._id }, { $addToSet: { bookedSeats: seat } });
    const boarding = route.stops.find((s) => s.type === 'boarding')!;
    const dropping = route.stops.filter((s) => s.type === 'dropping').at(-1)!;
    const paidAt = new Date(trip.departureTime.getTime() - 3 * 24 * HOUR_MS);
    await Booking.create({
      user: traveler!._id,
      trip: trip._id,
      route: route._id,
      pnr: generatePnr(),
      status,
      seats: [seat],
      passengers: [{ seat, name: DEMO_USERS.traveler.name, age: 27, gender: 'female' }],
      contact: { email: DEMO_USERS.traveler.email, phone: '9876543210' },
      boardingPoint: { name: boarding.name, offsetMinutes: boarding.offsetMinutes },
      droppingPoint: { name: dropping.name, offsetMinutes: dropping.offsetMinutes },
      journey: {
        from: route.from,
        to: route.to,
        departureTime: trip.departureTime,
        arrivalTime: trip.arrivalTime,
        operatorName: opById.get(String(trip.operator))!.name,
        busName: bus.name,
        busType: bus.type,
        ac: bus.ac,
      },
      farePerSeat: trip.fare,
      totalAmount: trip.fare,
      payment: { method: 'upi', transactionId: `TXNSEED${Math.floor(rand() * 1e6)}`, paidAt, status: 'paid' },
      completedAt: status === 'completed' ? trip.arrivalTime : undefined,
      createdAt: paidAt,
    });
  }

  console.log(
    `[seed] ${operators.length} operators, ${buses.length} buses, ${routes.length} routes, ${tripDocs.length} trips, ${chosen.length} demo bookings`,
  );
  console.log(`[seed] admin:      ${admin!.email} / ${env.admin.password}`);
  console.log(`[seed] traveler:   ${DEMO_USERS.traveler.email} / ${DEMO_USERS.traveler.password} (verified)`);
  console.log(`[seed] unverified: ${DEMO_USERS.unverified.email} / ${DEMO_USERS.unverified.password}`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[seed] failed', err);
  await disconnectDb();
  process.exit(1);
});
