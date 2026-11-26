import { env } from '../config/env';
import { CITY_COORDS } from '../data/places';
import { cityName } from '../i18n';
import { Route } from '../models/Route';
import { AppError } from '../utils/AppError';
import { MAX_ROUTE_POINTS, Point, bbox, distanceM, inIndia, simplify } from './planner.geo';

/**
 * Route planner providers (R3). TomTom (Search, Routing with live traffic, Map Display tiles) is used when a working
 * key is configured; the key never leaves the server. Without it, or when TomTom refuses the key (401/403), times out
 * or fails, search falls back to the app's own cities and stops and routing to the public OSRM router (no traffic).
 * Nothing here logs request URLs, so the key cannot end up in a log line.
 */

export type FallbackReason = 'no_key' | 'auth' | 'timeout' | 'unreachable' | 'rate_limited' | 'bad_request';

export class ProviderError extends Error {
  constructor(readonly reason: FallbackReason) {
    super(`provider unavailable: ${reason}`);
  }
}

/** After TomTom refuses the key, skip it for this long instead of failing every request. */
const AUTH_RETRY_MS = 5 * 60 * 1000;
/** A failed reachability check is remembered for this long (status endpoint). */
const PROBE_RETRY_MS = 60 * 1000;
const OK_TTL_MS = 5 * 60 * 1000;

const state = { authDownUntil: 0, lastOkAt: 0, probeFailedUntil: 0, probeReason: 'unreachable' as FallbackReason };
let probing: Promise<void> | null = null;

const hasKey = () => !!env.planner.tomtomKey;
const tomtomUsable = () => hasKey() && state.authDownUntil <= Date.now();

async function tomtomGet(path: string, params: Record<string, string | number | boolean | undefined>, as: 'json' | 'buffer') {
  if (!hasKey()) throw new ProviderError('no_key');
  if (state.authDownUntil > Date.now()) throw new ProviderError('auth');
  const url = new URL(env.planner.tomtomBaseUrl + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set('key', env.planner.tomtomKey);
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(env.planner.timeoutMs) });
  } catch (err) {
    throw new ProviderError((err as Error).name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
  if (res.status === 401 || res.status === 403) {
    state.authDownUntil = Date.now() + AUTH_RETRY_MS;
    void res.body?.cancel();
    throw new ProviderError('auth');
  }
  if (!res.ok) {
    void res.body?.cancel();
    throw new ProviderError(res.status === 429 ? 'rate_limited' : res.status === 400 ? 'bad_request' : 'unreachable');
  }
  try {
    const body = as === 'json' ? await res.json() : Buffer.from(await res.arrayBuffer());
    state.lastOkAt = Date.now();
    return body;
  } catch (err) {
    throw new ProviderError((err as Error).name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
}

function warn(what: string, reason: FallbackReason) {
  console.warn(`[planner] TomTom ${what} unavailable (${reason}); using the fallback`);
}

// ---------- Status

export interface PlannerStatus {
  provider: 'tomtom' | 'osrm';
  liveTraffic: boolean;
  tiles: 'tomtom' | 'osm';
  reason?: FallbackReason;
}

/** Which provider the planner will use right now (checks TomTom once with a tiny search when unsure). */
export async function plannerStatus(): Promise<PlannerStatus> {
  const fallback = (reason: FallbackReason): PlannerStatus => ({ provider: 'osrm', liveTraffic: false, tiles: 'osm', reason });
  if (!hasKey()) return fallback('no_key');
  if (state.authDownUntil > Date.now()) return fallback('auth');
  if (Date.now() - state.lastOkAt > OK_TTL_MS) {
    if (state.probeFailedUntil > Date.now()) return fallback(state.probeReason);
    probing ??= tomtomGet('/search/2/search/Mumbai.json', { limit: 1, countrySet: 'IN' }, 'json')
      .then(() => undefined)
      .catch((err) => {
        if (err instanceof ProviderError && err.reason !== 'auth') {
          state.probeFailedUntil = Date.now() + PROBE_RETRY_MS;
          state.probeReason = err.reason;
        }
      })
      .finally(() => (probing = null));
    await probing;
    if (state.authDownUntil > Date.now()) return fallback('auth');
    if (Date.now() - state.lastOkAt > OK_TTL_MS) return fallback(state.probeReason);
  }
  return { provider: 'tomtom', liveTraffic: true, tiles: 'tomtom' };
}

// ---------- Search

export interface Place {
  id: string;
  label: string;
  address: string;
  lat: number;
  lon: number;
  type: 'city' | 'stop' | 'poi' | 'street' | 'address';
}

const SEARCH_TTL_MS = 10 * 60 * 1000;
const searchCache = new Map<string, { at: number; results: Place[] }>();
/** TomTom label languages for the app languages it covers; the others get English names. */
const TOMTOM_LANGUAGES: Record<string, string> = { en: 'en-GB', hi: 'hi-IN' };

interface TomtomResult {
  id: string;
  type: string;
  poi?: { name?: string };
  address?: Record<string, string | undefined>;
  position?: { lat: number; lon: number };
}

function fromTomtom(r: TomtomResult): Place | null {
  if (!r.position || !inIndia(r.position)) return null;
  const a = r.address ?? {};
  const label =
    r.poi?.name ??
    (r.type === 'Geography'
      ? (a.municipality ?? a.countrySecondarySubdivision ?? a.countrySubdivision ?? a.freeformAddress)
      : a.streetName
        ? [a.streetNumber, a.streetName].filter(Boolean).join(' ')
        : a.freeformAddress);
  const type: Place['type'] = r.type === 'POI' ? 'poi' : r.type === 'Geography' ? 'city' : r.type === 'Street' || r.type === 'Cross Street' ? 'street' : 'address';
  return { id: `tt:${r.id}`, label: label ?? a.freeformAddress ?? '', address: a.freeformAddress ?? '', lat: r.position.lat, lon: r.position.lon, type };
}

async function tomtomSearch(q: string, near: Point | null, lang: string): Promise<Place[]> {
  const params = (language: string) => ({
    typeahead: true,
    limit: 8,
    countrySet: 'IN',
    view: 'IN',
    language,
    ...(near && { lat: near.lat, lon: near.lon }),
  });
  const language = TOMTOM_LANGUAGES[lang] ?? 'en-GB';
  const path = `/search/2/search/${encodeURIComponent(q)}.json`;
  let data: { results?: TomtomResult[] };
  try {
    data = await tomtomGet(path, params(language), 'json');
  } catch (err) {
    // A language TomTom does not know: ask again in English.
    if (err instanceof ProviderError && err.reason === 'bad_request' && language !== 'en-GB') data = await tomtomGet(path, params('en-GB'), 'json');
    else throw err;
  }
  return (data.results ?? []).map(fromTomtom).filter((p): p is Place => !!p);
}

type LocalPlace = { id: string; name: string; city: string; lat: number; lon: number; type: 'city' | 'stop' };
let localPlaces: { at: number; list: LocalPlace[] } | null = null;

/** MyBus cities and the stops of its routes that have coordinates (no external geocoder). */
async function mybusPlaces(): Promise<LocalPlace[]> {
  if (localPlaces && Date.now() - localPlaces.at < 5 * 60 * 1000) return localPlaces.list;
  const routes = await Route.find().select('from to stops').lean();
  const cities = [...new Set(routes.flatMap((r) => [r.from, r.to]))].filter((c) => CITY_COORDS[c]);
  const list: LocalPlace[] = cities.map((c) => ({ id: `city:${c}`, name: c, city: c, lat: CITY_COORDS[c][0], lon: CITY_COORDS[c][1], type: 'city' }));
  const seen = new Set<string>();
  for (const r of routes) {
    for (const s of r.stops) {
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number' || seen.has(s.name)) continue;
      seen.add(s.name);
      const [base, city] = s.name.split(',').map((v) => v.trim());
      list.push({ id: `stop:${s.name}`, name: base, city: city ?? '', lat: s.lat, lon: s.lon, type: 'stop' });
    }
  }
  localPlaces = { at: Date.now(), list };
  return list;
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function localSearch(q: string, near: Point | null, lang: string): Promise<Place[]> {
  const query = fold(q.trim());
  const scored: { place: Place; score: number; dist: number }[] = [];
  for (const p of await mybusPlaces()) {
    const label = p.type === 'city' ? cityName(lang, p.name) : p.name;
    const names = [p.name, label, ...(p.type === 'stop' && p.city ? [`${p.name} ${p.city}`, cityName(lang, p.city)] : [])].map(fold);
    const score = names.some((n) => n.startsWith(query)) ? 0 : names.some((n) => n.split(/[\s,]+/).some((w) => w.startsWith(query))) ? 1 : names.some((n) => n.includes(query)) ? 2 : -1;
    if (score < 0) continue;
    const address = p.type === 'stop' && p.city ? `${p.name}, ${cityName(lang, p.city)}` : label;
    scored.push({ place: { id: p.id, label, address, lat: p.lat, lon: p.lon, type: p.type }, score, dist: near ? distanceM(near, p) : 0 });
  }
  return scored
    .sort((a, b) => a.score - b.score || (a.place.type === 'city' ? 0 : 1) - (b.place.type === 'city' ? 0 : 1) || a.dist - b.dist || a.place.label.localeCompare(b.place.label))
    .slice(0, 8)
    .map((s) => s.place);
}

/** Typeahead search: TomTom when available (cached 10 min), otherwise the app's own places. */
export async function searchPlaces(q: string, near: Point | null, lang: string): Promise<{ results: Place[]; provider: 'tomtom' | 'mybus' }> {
  if (tomtomUsable()) {
    const key = `${lang}|${q.trim().toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ''}`;
    const hit = searchCache.get(key);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return { results: hit.results, provider: 'tomtom' };
    try {
      const results = await tomtomSearch(q.trim(), near, lang);
      if (searchCache.size > 500) searchCache.delete(searchCache.keys().next().value!);
      searchCache.set(key, { at: Date.now(), results });
      return { results, provider: 'tomtom' };
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      warn('search', err.reason);
    }
  }
  return { results: await localSearch(q, near, lang), provider: 'mybus' };
}

export async function cityPlaces() {
  const list = await mybusPlaces();
  return list.filter((p) => p.type === 'city').map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));
}

// ---------- Routing

export interface TrafficSection {
  startIndex: number;
  endIndex: number;
  delayS: number;
  /** TomTom magnitudeOfDelay: 0 unknown, 1 minor, 2 moderate, 3 major, 4 undefined (e.g. road closure). */
  magnitude: number;
  simpleCategory: string;
  effectiveSpeedKmh: number | null;
}

export interface PlannedRoute {
  id: string;
  kind: 'fastest' | 'alternative';
  summary: {
    distanceM: number;
    travelTimeS: number;
    noTrafficTimeS: number;
    historicTrafficTimeS: number | null;
    liveIncidentsTimeS: number | null;
    trafficDelayS: number;
    trafficLengthM: number;
    departureTime: string;
    arrivalTime: string;
  };
  points: [number, number][];
  bbox: [[number, number], [number, number]];
  legs: { distanceM: number; travelTimeS: number; trafficDelayS: number; startIndex: number }[];
  trafficSections: TrafficSection[];
}

export interface PlanInput {
  start: Point;
  end: Point;
  waypoints: Point[];
  departAt?: Date;
}

export interface PlanResult {
  routes: PlannedRoute[];
  provider: 'tomtom' | 'osrm';
  liveTraffic: boolean;
  fallbackReason?: FallbackReason;
}

interface TomtomRoute {
  summary: Record<string, number | string | undefined>;
  legs: { summary: Record<string, number | undefined>; points: { latitude: number; longitude: number }[] }[];
  sections?: {
    sectionType: string;
    startPointIndex: number;
    endPointIndex: number;
    simpleCategory?: string;
    effectiveSpeedInKmh?: number;
    delayInSeconds?: number;
    magnitudeOfDelay?: number;
  }[];
}

const n = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function normaliseTomtom(r: TomtomRoute, i: number): PlannedRoute {
  const raw: [number, number][] = [];
  const legStarts: number[] = [];
  for (const leg of r.legs) {
    legStarts.push(raw.length);
    for (const p of leg.points) raw.push([p.latitude, p.longitude]);
  }
  const sections = (r.sections ?? []).filter((s) => s.sectionType === 'TRAFFIC');
  const keep = new Set([...legStarts, ...legStarts.map((s) => s - 1), ...sections.flatMap((s) => [s.startPointIndex, s.endPointIndex])]);
  const { points, index } = simplify(raw, keep, MAX_ROUTE_POINTS);
  const s = r.summary;
  return {
    id: `tomtom-${i}`,
    kind: i === 0 ? 'fastest' : 'alternative',
    summary: {
      distanceM: n(s.lengthInMeters),
      travelTimeS: n(s.travelTimeInSeconds),
      noTrafficTimeS: n(s.noTrafficTravelTimeInSeconds, n(s.travelTimeInSeconds) - n(s.trafficDelayInSeconds)),
      historicTrafficTimeS: typeof s.historicTrafficTravelTimeInSeconds === 'number' ? s.historicTrafficTravelTimeInSeconds : null,
      liveIncidentsTimeS: typeof s.liveTrafficIncidentsTravelTimeInSeconds === 'number' ? s.liveTrafficIncidentsTravelTimeInSeconds : null,
      trafficDelayS: n(s.trafficDelayInSeconds),
      trafficLengthM: n(s.trafficLengthInMeters),
      departureTime: String(s.departureTime ?? new Date().toISOString()),
      arrivalTime: String(s.arrivalTime ?? new Date(Date.now() + n(s.travelTimeInSeconds) * 1000).toISOString()),
    },
    points,
    bbox: bbox(points),
    legs: r.legs.map((leg, li) => ({
      distanceM: n(leg.summary.lengthInMeters),
      travelTimeS: n(leg.summary.travelTimeInSeconds),
      trafficDelayS: n(leg.summary.trafficDelayInSeconds),
      startIndex: index(legStarts[li]),
    })),
    trafficSections: sections.map((sec) => ({
      startIndex: index(sec.startPointIndex),
      endIndex: index(sec.endPointIndex),
      delayS: n(sec.delayInSeconds),
      magnitude: Math.max(0, Math.min(4, n(sec.magnitudeOfDelay))),
      simpleCategory: sec.simpleCategory ?? 'OTHER',
      effectiveSpeedKmh: typeof sec.effectiveSpeedInKmh === 'number' ? sec.effectiveSpeedInKmh : null,
    })),
  };
}

async function tomtomRoutes(input: PlanInput): Promise<PlannedRoute[]> {
  const locations = [input.start, ...input.waypoints, input.end].map((p) => `${p.lat},${p.lon}`).join(':');
  const params = (maxAlternatives: number) => ({
    traffic: true,
    travelMode: 'bus',
    routeType: 'fastest',
    maxAlternatives,
    computeTravelTimeFor: 'all',
    sectionType: 'traffic',
    routeRepresentation: 'polyline',
    ...(input.departAt && { departAt: input.departAt.toISOString() }),
  });
  const path = `/routing/1/calculateRoute/${locations}/json`;
  let data: { routes?: TomtomRoute[] };
  try {
    data = await tomtomGet(path, params(2), 'json');
  } catch (err) {
    // If alternatives are refused for this request (e.g. with waypoints), still give the main route with traffic.
    if (err instanceof ProviderError && err.reason === 'bad_request') data = await tomtomGet(path, params(0), 'json');
    else throw err;
  }
  if (!data.routes?.length) throw new ProviderError('bad_request');
  return data.routes.slice(0, 3).map(normaliseTomtom);
}

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: { distance: number; duration: number }[];
}

async function osrmRoutes(input: PlanInput): Promise<PlannedRoute[]> {
  const all = [input.start, ...input.waypoints, input.end];
  const coords = all.map((p) => `${p.lon},${p.lat}`).join(';');
  // OSRM only offers alternatives for plain A → B requests.
  const url = `${env.planner.osrmBaseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&alternatives=${input.waypoints.length ? 'false' : '2'}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(env.planner.timeoutMs), headers: { 'User-Agent': 'MyBus route planner' } });
  } catch (err) {
    throw new ProviderError((err as Error).name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }
  const data = (await res.json().catch(() => null)) as { code?: string; routes?: OsrmRoute[] } | null;
  if (data?.code === 'NoRoute' || data?.code === 'NoSegment') throw new AppError(404, 'PLANNER_NO_ROUTE', 'No road route was found between these places');
  if (!res.ok || data?.code !== 'Ok' || !data.routes?.length) throw new ProviderError('unreachable');
  const departure = input.departAt ?? new Date();
  return data.routes.slice(0, 3).map((r, i) => {
    const raw = r.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
    // Leg boundaries: the point nearest to each waypoint.
    const legStarts = [0, ...input.waypoints.map((w) => nearestIndex(raw, w))];
    const { points, index } = simplify(raw, new Set(legStarts), MAX_ROUTE_POINTS);
    return {
      id: `osrm-${i}`,
      kind: i === 0 ? 'fastest' : 'alternative',
      summary: {
        distanceM: Math.round(r.distance),
        travelTimeS: Math.round(r.duration),
        noTrafficTimeS: Math.round(r.duration),
        historicTrafficTimeS: null,
        liveIncidentsTimeS: null,
        trafficDelayS: 0,
        trafficLengthM: 0,
        departureTime: departure.toISOString(),
        arrivalTime: new Date(departure.getTime() + r.duration * 1000).toISOString(),
      },
      points,
      bbox: bbox(points),
      legs: r.legs.map((leg, li) => ({ distanceM: Math.round(leg.distance), travelTimeS: Math.round(leg.duration), trafficDelayS: 0, startIndex: index(legStarts[li] ?? 0) })),
      trafficSections: [],
    } satisfies PlannedRoute;
  });
}

function nearestIndex(points: [number, number][], p: Point): number {
  let best = 0;
  let bestD = Infinity;
  points.forEach(([lat, lon], i) => {
    const d = (lat - p.lat) ** 2 + (lon - p.lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Suggested routes with live traffic from TomTom, or OSRM routes without traffic when TomTom is not available. */
export async function planRoutes(input: PlanInput): Promise<PlanResult> {
  let reason: FallbackReason;
  try {
    return { routes: await tomtomRoutes(input), provider: 'tomtom', liveTraffic: true };
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    reason = err.reason;
    if (reason !== 'no_key') warn('routing', reason);
  }
  try {
    return { routes: await osrmRoutes(input), provider: 'osrm', liveTraffic: false, fallbackReason: reason };
  } catch (err) {
    if (err instanceof ProviderError) {
      console.warn(`[planner] OSRM routing unavailable (${err.reason})`);
      throw new AppError(503, 'PLANNER_UNAVAILABLE', 'Route planning is not available right now');
    }
    throw err;
  }
}

// ---------- Map tiles

const TILE_TTL_MS = 60 * 60 * 1000;
const tileCache = new Map<string, { at: number; png: Buffer }>();

/** A TomTom raster tile (basic main or night style, India view), cached in memory for an hour. */
export async function mapTile(style: 'main' | 'night', z: number, x: number, y: number): Promise<Buffer> {
  const key = `${style}/${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit && Date.now() - hit.at < TILE_TTL_MS) return hit.png;
  const png = (await tomtomGet(`/map/1/tile/basic/${style}/${z}/${x}/${y}.png`, { tileSize: 256, view: 'IN' }, 'buffer')) as Buffer;
  if (tileCache.size >= 400) tileCache.delete(tileCache.keys().next().value!);
  tileCache.set(key, { at: Date.now(), png });
  return png;
}
