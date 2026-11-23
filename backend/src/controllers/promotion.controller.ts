import type { Request, Response } from 'express';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { PROMOTION_TARGETS, Promotion } from '../models/Promotion';
import { Route } from '../models/Route';
import { PromotionTarget, previewPromotion, runPromotion } from '../services/promotion.service';
import { badRequest } from '../utils/AppError';
import { validate } from '../utils/validate';

const TITLE_MAX = 80;
const BODY_MAX = 500;
const OTHER_LANGUAGES = SUPPORTED_LANGUAGES.filter((l) => l !== 'en');

/** Validates the target (cities must exist in the network) and returns it in a clean shape. */
async function parseTarget(raw: unknown): Promise<PromotionTarget> {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  validate({ 'target.kind': t.kind }, { 'target.kind': { type: 'string', required: true, enum: PROMOTION_TARGETS } });
  if (t.kind === 'all') return { kind: 'all' };
  const [from, to] = await Promise.all([Route.distinct('from'), Route.distinct('to')]);
  const cities = [...new Set([...from, ...to])];
  if (t.kind === 'city') {
    validate({ 'target.city': t.city }, { 'target.city': { type: 'string', required: true, enum: cities } });
    return { kind: 'city', city: String(t.city) };
  }
  validate({ 'target.from': t.from, 'target.to': t.to }, {
    'target.from': { type: 'string', required: true, enum: cities },
    'target.to': { type: 'string', required: true, enum: cities },
  });
  if (t.from === t.to) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'target.to', rule: 'different' }]);
  return { kind: 'route', from: String(t.from), to: String(t.to) };
}

/** English title/body are required; another language is used only when both its title and body are given. */
function parseContent(body: Record<string, unknown>) {
  validate(body, { title: { type: 'string', required: true, min: 3, max: TITLE_MAX }, body: { type: 'string', required: true, min: 3, max: BODY_MAX } });
  const raw = (body.translations && typeof body.translations === 'object' ? body.translations : {}) as Record<string, { title?: unknown; body?: unknown }>;
  const translations: Record<string, { title: string; body: string }> = {};
  for (const lang of OTHER_LANGUAGES) {
    const title = typeof raw[lang]?.title === 'string' ? String(raw[lang]!.title).trim() : '';
    const text = typeof raw[lang]?.body === 'string' ? String(raw[lang]!.body).trim() : '';
    if (!title && !text) continue;
    validate({ [`translations.${lang}.title`]: title, [`translations.${lang}.body`]: text }, {
      [`translations.${lang}.title`]: { type: 'string', required: true, max: TITLE_MAX },
      [`translations.${lang}.body`]: { type: 'string', required: true, max: BODY_MAX },
    });
    translations[lang] = { title, body: text };
  }
  return { title: String(body.title).trim(), body: String(body.body).trim(), translations };
}

/** POST /admin/promotions/preview: recipient count for a target before sending. */
export async function preview(req: Request, res: Response) {
  res.json(await previewPromotion(await parseTarget(req.body?.target)));
}

/** POST /admin/promotions: creates the campaign and sends it in the background. */
export async function send(req: Request, res: Response) {
  const content = parseContent(req.body ?? {});
  const target = await parseTarget(req.body?.target);
  const { recipients } = await previewPromotion(target);
  if (!recipients) throw badRequest('PROMOTION_NO_RECIPIENTS', 'No opted-in users match this target');
  const promotion = await Promotion.create({ ...content, target, recipients, createdBy: req.user!._id });
  void runPromotion(promotion).catch((err) => console.error('[promotion] send failed', err));
  res.status(202).json({ promotion: view(promotion.toObject()) });
}

/** GET /admin/promotions: recent campaigns with progress. */
export async function list(_req: Request, res: Response) {
  const items = await Promotion.find().sort({ createdAt: -1 }).limit(20).lean();
  res.json({ promotions: items.map(view) });
}

function view(p: { _id: unknown; title: string; target?: unknown; status: string; recipients: number; sent: number; createdAt?: Date; translations?: unknown }) {
  return {
    id: String(p._id),
    title: p.title,
    target: p.target,
    languages: ['en', ...Object.keys((p.translations as object) ?? {})],
    status: p.status,
    recipients: p.recipients,
    sent: p.sent,
    createdAt: p.createdAt,
  };
}
