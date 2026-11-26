import type { Request, Response } from 'express';
import { isLang } from '../i18n';
import { MAX_WAYPOINTS, Point, inIndia, parseLatLon, readPoint } from '../services/planner.geo';
import { ProviderError, cityPlaces, mapTile, planRoutes, plannerStatus, searchPlaces } from '../services/planner.service';
import { AppError, badRequest } from '../utils/AppError';
import { allow } from '../utils/rate-limit';

/** Route planner endpoints (R3). Everything goes through the server so the map provider key stays private. */

const LIMITS = { search: 60, routes: 20, tiles: 600 } as const;
const MAX_DEPART_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;

function limit(req: Request, kind: keyof typeof LIMITS) {
  if (!allow(`planner-${kind}:${req.ip ?? 'unknown'}`, LIMITS[kind], 60_000)) throw new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again in a minute');
}

const languageOf = (req: Request) => (isLang(req.query.lang) ? req.query.lang : (req.user?.language ?? 'en'));

/** GET /planner/status: provider in use, whether live traffic is available and which map tiles to use. */
export async function status(_req: Request, res: Response) {
  res.json(await plannerStatus());
}

/** GET /planner/cities: MyBus cities with coordinates (quick picks, links from route pages). */
export async function cities(_req: Request, res: Response) {
  res.json({ cities: await cityPlaces() });
}

/** GET /planner/search?q=&near=lat,lon&lang= : typeahead suggestions. */
export async function search(req: Request, res: Response) {
  limit(req, 'search');
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2 || q.length > 100) {
    throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'q', rule: q.length < 2 ? 'minlength' : 'maxlength', params: { min: 2, max: 100 } }]);
  }
  const near = parseLatLon(req.query.near);
  res.json(await searchPlaces(q, near && inIndia(near) ? near : null, languageOf(req)));
}

function readPlace(value: unknown, field: string): Point {
  if (value === undefined || value === null) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field, rule: 'required' }]);
  const p = readPoint(value);
  if (!p) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field, rule: 'type' }]);
  if (!inIndia(p)) throw badRequest('PLANNER_OUTSIDE_INDIA', 'Places must be in India', [{ field, rule: 'bounds' }]);
  return p;
}

/** POST /planner/routes { start, end, waypoints?: [] (≤ 5), departAt? }: suggested routes with ETAs and traffic. */
export async function routes(req: Request, res: Response) {
  limit(req, 'routes');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const start = readPlace(body.start, 'start');
  const end = readPlace(body.end, 'end');
  if (body.waypoints !== undefined && !Array.isArray(body.waypoints)) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'waypoints', rule: 'type' }]);
  const list = (body.waypoints as unknown[] | undefined) ?? [];
  if (list.length > MAX_WAYPOINTS) {
    throw badRequest('PLANNER_TOO_MANY_WAYPOINTS', `At most ${MAX_WAYPOINTS} stops`, [{ field: 'waypoints', rule: 'maxItems', params: { max: MAX_WAYPOINTS } }]);
  }
  const waypoints = list.map((w, i) => readPlace(w, `waypoints.${i}`));
  let departAt: Date | undefined;
  if (body.departAt !== undefined && body.departAt !== null && body.departAt !== '') {
    departAt = new Date(String(body.departAt));
    const t = departAt.getTime();
    if (Number.isNaN(t)) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'departAt', rule: 'date' }]);
    if (t < Date.now() - 60_000 || t > Date.now() + MAX_DEPART_AHEAD_MS) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'departAt', rule: 'range' }]);
  }
  const result = await planRoutes({ start, end, waypoints, departAt });
  res.json({ ...result, departAt: departAt?.toISOString() ?? null });
}

/** GET /planner/tiles/:z/:x/:y.png?style=main|night : map tiles from the provider (key added on the server). */
export async function tile(req: Request, res: Response) {
  limit(req, 'tiles');
  const [z, x, y] = [req.params.z, req.params.x, req.params.y].map((v) => (/^\d{1,7}$/.test(String(v)) ? Number(v) : NaN));
  const size = 2 ** z;
  if (!Number.isInteger(z) || z < 0 || z > 20 || !Number.isInteger(x) || !Number.isInteger(y) || x >= size || y >= size) {
    throw badRequest('VALIDATION_ERROR', 'Invalid tile', [{ field: 'tile', rule: 'range' }]);
  }
  const style = req.query.style === 'night' ? 'night' : 'main';
  try {
    const png = await mapTile(style, z, x, y);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(png);
  } catch (err) {
    if (err instanceof ProviderError) throw new AppError(503, 'PLANNER_TILES_UNAVAILABLE', 'Map tiles are not available right now');
    throw err;
  }
}
