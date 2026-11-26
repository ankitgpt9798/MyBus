import type { Request, Response } from 'express';
import { MAX_SAVED_ROUTES, SavedRoute } from '../models/SavedRoute';
import { MAX_WAYPOINTS, inIndia, readPoint } from '../services/planner.geo';
import { badRequest, conflict, notFound } from '../utils/AppError';
import { isObjectId } from '../utils/validate';

/** Saved routes (R3): a signed-in user keeps up to 20 plans for quick access. Only the owner can see or change them. */

const NAME = { min: 1, max: 60 };
const LABEL_MAX = 120;

type Place = { label: string; lat: number; lon: number };

function readName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < NAME.min) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'name', rule: 'required' }]);
  if (name.length > NAME.max) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'name', rule: 'maxlength', params: { max: NAME.max } }]);
  return name;
}

function readPlace(value: unknown, field: string): Place {
  const p = readPoint(value);
  if (!p) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field, rule: value ? 'type' : 'required' }]);
  if (!inIndia(p)) throw badRequest('PLANNER_OUTSIDE_INDIA', 'Places must be in India', [{ field, rule: 'bounds' }]);
  const raw = (value as { label?: unknown }).label;
  const label = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, LABEL_MAX) : `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`;
  return { label, lat: p.lat, lon: p.lon };
}

const signatureOf = (places: Place[]) => places.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';');

type SavedLean = { _id: unknown; name: string; start: Place; end: Place; waypoints: Place[]; useCount: number; lastUsedAt?: Date | null; createdAt: Date };
const place = (p: Place) => ({ label: p.label, lat: p.lat, lon: p.lon });
const view = (s: SavedLean) => ({
  id: String(s._id),
  name: s.name,
  start: place(s.start),
  end: place(s.end),
  waypoints: s.waypoints.map(place),
  useCount: s.useCount,
  lastUsedAt: s.lastUsedAt ?? null,
  createdAt: s.createdAt,
});

async function loadOwn(req: Request) {
  if (!isObjectId(req.params.id)) throw notFound('PLANNER_SAVED_NOT_FOUND', 'Saved route not found');
  const saved = await SavedRoute.findOne({ _id: req.params.id, user: req.user!._id });
  if (!saved) throw notFound('PLANNER_SAVED_NOT_FOUND', 'Saved route not found');
  return saved;
}

/** GET /planner/saved?sort=used|recent&limit= */
export async function list(req: Request, res: Response) {
  const recent = req.query.sort === 'recent';
  const limit = Math.min(MAX_SAVED_ROUTES, Math.max(1, Number(req.query.limit) || MAX_SAVED_ROUTES));
  const rows = await SavedRoute.find({ user: req.user!._id })
    .sort(recent ? { lastUsedAt: -1, createdAt: -1 } : { useCount: -1, lastUsedAt: -1, createdAt: -1 })
    .limit(limit)
    .lean();
  res.json({ saved: rows.map((r) => view(r as unknown as SavedLean)), max: MAX_SAVED_ROUTES, sort: recent ? 'recent' : 'used' });
}

/** POST /planner/saved { name, start, end, waypoints? } with places as { label, lat, lon } */
export async function create(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = readName(body.name);
  const start = readPlace(body.start, 'start');
  const end = readPlace(body.end, 'end');
  if (body.waypoints !== undefined && !Array.isArray(body.waypoints)) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'waypoints', rule: 'type' }]);
  const list = (body.waypoints as unknown[] | undefined) ?? [];
  if (list.length > MAX_WAYPOINTS) throw badRequest('PLANNER_TOO_MANY_WAYPOINTS', `At most ${MAX_WAYPOINTS} stops`, [{ field: 'waypoints', rule: 'maxItems', params: { max: MAX_WAYPOINTS } }]);
  const waypoints = list.map((w, i) => readPlace(w, `waypoints.${i}`));
  const signature = signatureOf([start, ...waypoints, end]);
  const userId = req.user!._id;
  const existing = await SavedRoute.findOne({ user: userId, signature }).select('_id name').lean();
  if (existing) throw conflict('PLANNER_SAVED_DUPLICATE', 'This route is already saved', [{ field: 'route', rule: 'duplicate', params: { id: String(existing._id), name: existing.name } }]);
  if ((await SavedRoute.countDocuments({ user: userId })) >= MAX_SAVED_ROUTES) {
    throw conflict('PLANNER_SAVED_LIMIT', `At most ${MAX_SAVED_ROUTES} saved routes`, [{ field: 'route', rule: 'maxItems', params: { max: MAX_SAVED_ROUTES } }]);
  }
  try {
    const saved = await SavedRoute.create({ user: userId, name, start, end, waypoints, signature });
    res.status(201).json({ saved: view(saved.toObject() as unknown as SavedLean) });
  } catch (err) {
    // Two saves of the same plan at once: the unique index keeps one.
    if ((err as { code?: number }).code === 11000) throw conflict('PLANNER_SAVED_DUPLICATE', 'This route is already saved', [{ field: 'route', rule: 'duplicate' }]);
    throw err;
  }
}

/** PATCH /planner/saved/:id { name } */
export async function rename(req: Request, res: Response) {
  const saved = await loadOwn(req);
  saved.name = readName((req.body ?? {}).name);
  await saved.save();
  res.json({ saved: view(saved.toObject() as unknown as SavedLean) });
}

/** DELETE /planner/saved/:id */
export async function remove(req: Request, res: Response) {
  const saved = await loadOwn(req);
  await saved.deleteOne();
  res.json({ deleted: true });
}

/** POST /planner/saved/:id/use: the route was opened (most-used ordering and quick access). */
export async function use(req: Request, res: Response) {
  const saved = await loadOwn(req);
  const updated = await SavedRoute.findByIdAndUpdate(saved._id, { $inc: { useCount: 1 }, $set: { lastUsedAt: new Date() } }, { new: true }).lean();
  res.json({ saved: view(updated as unknown as SavedLean) });
}
