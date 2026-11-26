/**
 * Resets the catalogue (operators, buses, routes, trips, bookings, reviews, community posts) and upserts the admin + demo users.
 * Run with: npm run seed
 */
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { Booking } from '../models/Booking';
import { Bus } from '../models/Bus';
import { Operator } from '../models/Operator';
import { Review } from '../models/Review';
import { RevokedToken } from '../models/RevokedToken';
import { Route } from '../models/Route';
import { Trip } from '../models/Trip';
import { User } from '../models/User';
import { generatePnr } from '../services/booking.service';
import { REVIEW_EDIT_WINDOW_MS, REVIEW_HIDE_THRESHOLD } from '../services/review.rules';
import { stopCoords } from '../data/places';
import { seedCommunity, seedReactions } from './community';
import { Comment } from '../models/Comment';
import { Post } from '../models/Post';
import { Reaction } from '../models/Reaction';
import { SavedRoute } from '../models/SavedRoute';
import { recomputeRouteRating } from '../services/review.service';
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

// Verified demo travellers whose completed journeys carry the seeded reviews (password Traveler@123).
const REVIEWERS = [
  { name: 'Priya Nair', email: 'priya.reviews@mybus.local', language: 'en' },
  { name: 'Rahul Verma', email: 'rahul.reviews@mybus.local', language: 'hi' },
  { name: 'Sneha Patil', email: 'sneha.reviews@mybus.local', language: 'mr' },
  { name: 'Ananya Das', email: 'ananya.reviews@mybus.local', language: 'bn' },
  { name: 'Kiran Reddy', email: 'kiran.reviews@mybus.local', language: 'te' },
  { name: 'Vikram Singh', email: 'vikram.reviews@mybus.local', language: 'en' },
  { name: 'Meena Iyer', email: 'meena.reviews@mybus.local', language: 'en' },
] as const;

// by = index in REVIEWERS. Priya (12 votes / 3 reviews) and Rahul (11 / 3) qualify as trusted reviewers.
// One review sits one report below the auto-hide threshold; one was hidden by reports.
const SEED_REVIEWS: { by: number; route: [string, string]; rating: number; text: string; helpful: number; reports?: number }[] = [
  { by: 0, route: ['Mumbai', 'Pune'], rating: 5, helpful: 5, text: 'Very smooth ride on the expressway. The bus left on time, the seats were clean and the AC worked well throughout.' },
  { by: 2, route: ['Mumbai', 'Pune'], rating: 4, helpful: 2, text: 'बस वेळेवर सुटली आणि प्रवास आरामदायक झाला. फक्त चढण्याच्या ठिकाणी थोडी गर्दी होती.' },
  { by: 6, route: ['Mumbai', 'Pune'], rating: 3, helpful: 1, reports: REVIEW_HIDE_THRESHOLD - 1, text: 'Decent journey but the driver took a long tea break at the food mall, so we reached forty minutes late.' },
  { by: 5, route: ['Mumbai', 'Pune'], rating: 1, helpful: 0, reports: REVIEW_HIDE_THRESHOLD, text: 'Worst bus ever, total waste of money, never book this operator again, avoid avoid avoid!!!' },
  { by: 1, route: ['Pune', 'Mumbai'], rating: 5, helpful: 4, text: 'ड्राइवर बहुत सावधानी से चला रहा था और बस समय पर मुंबई पहुँच गई। सीटें आरामदायक थीं।' },
  { by: 0, route: ['Bengaluru', 'Chennai'], rating: 4, helpful: 4, text: 'Comfortable sleeper berth and helpful staff. Charging points worked, though the blanket could have been cleaner.' },
  { by: 4, route: ['Bengaluru', 'Chennai'], rating: 5, helpful: 2, text: 'బస్సు చాలా శుభ్రంగా ఉంది, సిబ్బంది మర్యాదగా ప్రవర్తించారు. సమయానికి చెన్నై చేరుకున్నాం.' },
  { by: 1, route: ['Bengaluru', 'Chennai'], rating: 4, helpful: 4, text: 'रात का सफ़र अच्छा रहा, बस में ज़्यादा शोर नहीं था और पानी की बोतल भी मिली।' },
  { by: 0, route: ['Delhi', 'Jaipur'], rating: 5, helpful: 3, text: 'Excellent service from start to finish. Boarding at the pickup point was well organised and we arrived early.' },
  { by: 3, route: ['Delhi', 'Jaipur'], rating: 4, helpful: 1, text: 'যাত্রা বেশ আরামদায়ক ছিল, বাস পরিষ্কার ছিল এবং আমরা সময়মতো জয়পুর পৌঁছেছি।' },
  { by: 1, route: ['Delhi', 'Jaipur'], rating: 3, helpful: 3, text: 'बस ठीक थी लेकिन एसी बहुत तेज़ था और कंबल नहीं दिया गया। बाकी सफ़र ठीक रहा।' },
  { by: 4, route: ['Hyderabad', 'Bengaluru'], rating: 4, helpful: 1, text: 'ప్రయాణం సౌకర్యంగా సాగింది. మధ్యలో ఆగిన చోట భోజనం బాగుంది, కానీ కొంచెం ఆలస్యమైంది.' },
  { by: 3, route: ['Hyderabad', 'Bengaluru'], rating: 5, helpful: 0, text: 'চমৎকার যাত্রা! সিটগুলো আরামদায়ক, কর্মীরা ভদ্র এবং বাস একদম সময়ে ছেড়েছে।' },
];

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

type SeatDef = { number: string; deck: 'lower' | 'upper'; row: number; col: number; kind: 'seater' | 'sleeper'; ladiesOnly?: boolean };

// Women-reserved seats: a window pair in the second row on seaters, a lower-deck pair on sleepers.
const LADIES_SEATS = { seater: ['5', '6'], sleeper: ['L5', 'L6'] } as const;

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
  const ladies: readonly string[] = LADIES_SEATS[type];
  return seats.map((s) => (ladies.includes(s.number) ? { ...s, ladiesOnly: true } : s));
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
  // Each stop gets its map position (route planner search and quick picks).
  return [...boarding, ...viaStops, ...dropping].map((s) => {
    const at = stopCoords(s.name);
    return at ? { ...s, lat: at[0], lon: at[1] } : s;
  });
}

function fareFor(distanceKm: number, type: 'seater' | 'sleeper', ac: boolean) {
  const base = distanceKm * FARE_PER_KM[type][ac ? 'ac' : 'nonac'] * (0.9 + rand() * 0.25);
  return Math.max(199, Math.round(base / 10) * 10 - 1);
}

async function upsertUser(data: { name: string; email: string; password: string; emailVerified: boolean; role?: 'user' | 'admin'; language?: string }) {
  const passwordHash = await bcrypt.hash(data.password, 10);
  return User.findOneAndUpdate(
    { email: data.email },
    {
      $set: { name: data.name, passwordHash, emailVerified: data.emailVerified, role: data.role ?? 'user' },
      $setOnInsert: { language: data.language ?? 'en', theme: 'light' },
    },
    { upsert: true, returnDocument: 'after' },
  );
}

async function main() {
  await connectDb();
  const models = [User, RevokedToken, Operator, Bus, Route, Trip, Booking, Review, Post, Comment, Reaction, SavedRoute];
  for (const m of models) await m.syncIndexes();

  console.log('[seed] clearing catalogue and bookings…');
  await Promise.all([
    Review.deleteMany({}),
    Booking.deleteMany({}),
    Trip.deleteMany({}),
    Route.deleteMany({}),
    Bus.deleteMany({}),
    Operator.deleteMany({}),
  ]);

  // Users
  const admin = await upsertUser({ name: env.admin.name, email: env.admin.email, password: env.admin.password, emailVerified: true, role: 'admin' });
  const traveler = await upsertUser(DEMO_USERS.traveler);
  await upsertUser(DEMO_USERS.unverified);
  const reviewers: NonNullable<Awaited<ReturnType<typeof upsertUser>>>[] = [];
  for (const r of REVIEWERS) reviewers.push((await upsertUser({ ...r, password: DEMO_USERS.traveler.password, emailVerified: true }))!);
  // Demo members joined a few months back (their reviews and posts are older than the seed run); only newer join dates are moved.
  const dayMs = 24 * 60 * 60 * 1000;
  for (const [i, u] of [traveler!, ...reviewers].entries()) {
    const joined = new Date(Date.now() - (75 + i * 17) * dayMs);
    await User.collection.updateOne({ _id: u._id, createdAt: { $gt: joined } }, { $set: { createdAt: joined } });
  }

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
        // Women-reserved seats are left free (there is no passenger record to say who holds them).
        const bookedSeats = bus.seats.filter((s) => !s.ladiesOnly && rand() < occupancy).map((s) => s.number);
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
  type TripDoc = (typeof tripDocs)[number];
  async function makeBooking(user: { _id: Types.ObjectId; name: string; email: string }, trip: TripDoc, status: 'completed' | 'confirmed') {
    const bus = busById.get(String(trip.bus))!;
    const route = routeById.get(String(trip.route))!;
    const seat = bus.seats.find((s) => !s.ladiesOnly && !trip.bookedSeats.includes(s.number))!.number;
    trip.bookedSeats.push(seat);
    await Trip.updateOne({ _id: trip._id }, { $addToSet: { bookedSeats: seat } });
    const boarding = route.stops.find((s) => s.type === 'boarding')!;
    const dropping = route.stops.filter((s) => s.type === 'dropping').at(-1)!;
    const paidAt = new Date(trip.departureTime.getTime() - 3 * 24 * HOUR_MS);
    return Booking.create({
      user: user._id,
      trip: trip._id,
      route: route._id,
      pnr: generatePnr(),
      status,
      seats: [seat],
      passengers: [{ seat, name: user.name, age: 27, gender: 'female' }],
      contact: { email: user.email, phone: '9876543210' },
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
  for (const { trip, status } of chosen) await makeBooking(traveler!, trip, status);

  // Reviews on completed journeys of the demo reviewers, with helpful votes and reports.
  const othersThan = (author: number) => [...reviewers.filter((_, i) => i !== author), traveler!];
  const touchedRoutes = new Set<string>();
  let reviewCount = 0;
  for (const [i, r] of SEED_REVIEWS.entries()) {
    const route = routes.find((x) => x.from === r.route[0] && x.to === r.route[1]);
    if (!route) continue;
    const trips = pastTrips.filter((t) => String(t.route) === String(route._id));
    const trip = trips[(i * 3) % trips.length];
    const author = reviewers[r.by];
    const booking = await makeBooking(author, trip, 'completed');
    const createdAt = new Date(Math.min(trip.arrivalTime.getTime() + 3 * HOUR_MS, now - HOUR_MS));
    const voters = othersThan(r.by).slice(0, r.helpful);
    const reporters = othersThan(r.by).reverse().slice(0, r.reports ?? 0);
    const reasons = ['spam', 'offensive', 'fake'] as const;
    const hidden = (r.reports ?? 0) >= REVIEW_HIDE_THRESHOLD;
    await Review.create({
      user: author._id,
      route: route._id,
      trip: trip._id,
      booking: booking._id,
      rating: r.rating,
      text: r.text,
      status: hidden ? 'hidden' : 'visible',
      moderation: hidden ? { reason: 'reports', auto: true, at: createdAt } : undefined,
      reports: reporters.map((u, k) => ({ user: u._id, reason: reasons[k % reasons.length], createdAt })),
      reportCount: reporters.length,
      helpfulBy: voters.map((u) => u._id),
      helpfulCount: voters.length,
      editableUntil: new Date(createdAt.getTime() + REVIEW_EDIT_WINDOW_MS),
      createdAt,
    });
    touchedRoutes.add(String(route._id));
    reviewCount++;
  }
  for (const id of touchedRoutes) await recomputeRouteRating(id);

  // Community: demo posts, comments and likes by the reviewers (photos are generated into uploads/community).
  const community = await seedCommunity(reviewers, [traveler!], routes);
  const reactions = await seedReactions();

  console.log(
    `[seed] ${operators.length} operators, ${buses.length} buses, ${routes.length} routes, ${tripDocs.length} trips, ${chosen.length} demo bookings, ${reviewCount} reviews on ${touchedRoutes.size} routes, ${community.posts} community posts (${community.comments} comments, ${community.photos} photos, ${reactions} likes and votes)`,
  );
  console.log(`[seed] admin:      ${admin!.email} / ${env.admin.password}`);
  console.log(`[seed] traveler:   ${DEMO_USERS.traveler.email} / ${DEMO_USERS.traveler.password} (verified)`);
  console.log(`[seed] unverified: ${DEMO_USERS.unverified.email} / ${DEMO_USERS.unverified.password}`);
  console.log(`[seed] reviewers:  ${REVIEWERS.map((r) => r.email).join(', ')} / ${DEMO_USERS.traveler.password}`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[seed] failed', err);
  await disconnectDb();
  process.exit(1);
});
