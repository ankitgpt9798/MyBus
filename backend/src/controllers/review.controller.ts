import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Booking } from '../models/Booking';
import { REMOVE_REASONS, REPORT_REASONS, Review } from '../models/Review';
import { Route } from '../models/Route';
import { completeArrivedBookings } from '../services/booking.service';
import { recordReaction } from '../services/community.service';
import {
  REVIEW_EDIT_WINDOW_MS,
  REVIEW_HIDE_THRESHOLD,
  REVIEW_MAX_LENGTH,
  REVIEW_MIN_LENGTH,
  REVIEW_SORTS,
  guidelineViolation,
} from '../services/review.rules';
import { publicReview, recomputeRouteRating, reviewerStats, routeSummary, trustedReviewersOfRoute } from '../services/review.service';
import { badRequest, conflict, forbidden, notFound } from '../utils/AppError';
import { isObjectId, validate } from '../utils/validate';

const paging = (req: Request, max = 50) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(max, Math.max(1, Number(req.query.limit) || 10));
  return { page, limit, skip: (page - 1) * limit };
};

/** Rating must be a whole number 1-5; text is trimmed, 30-1000 characters and within the content guidelines. */
function checkContent(body: Record<string, unknown>, partial: boolean): { rating?: number; text?: string } {
  validate(body, {
    rating: { type: 'number', required: !partial, min: 1, max: 5 },
    text: { type: 'string', required: !partial, min: REVIEW_MIN_LENGTH, max: REVIEW_MAX_LENGTH },
  });
  const out: { rating?: number; text?: string } = {};
  if (body.rating !== undefined) {
    const rating = Number(body.rating);
    if (!Number.isInteger(rating)) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'rating', rule: 'integer' }]);
    out.rating = rating;
  }
  if (body.text !== undefined) {
    const text = String(body.text).trim().replace(/\s+\n/g, '\n');
    const rule = guidelineViolation(text);
    if (rule) throw badRequest('REVIEW_GUIDELINES', 'The review breaks the content guidelines', [{ field: 'text', rule }]);
    out.text = text;
  }
  if (partial && out.rating === undefined && out.text === undefined) {
    throw badRequest('VALIDATION_ERROR', 'Nothing to update', [{ field: 'text', rule: 'required' }]);
  }
  return out;
}

const viewerOf = (req: Request) => (req.user ? String(req.user._id) : null);

async function loadVisible(id: unknown) {
  if (!isObjectId(id)) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
  const review = await Review.findById(id);
  if (!review || review.status !== 'visible') throw notFound('REVIEW_NOT_FOUND', 'Review not found');
  return review;
}

async function viewOne(id: Types.ObjectId, viewer: string | null) {
  const r = await Review.findById(id).populate('user', 'name').populate('booking', 'journey.departureTime').lean();
  const stats = await reviewerStats([String((r!.user as unknown as { _id: Types.ObjectId })._id)]);
  return publicReview(r as never, viewer, stats);
}

/** POST /reviews { bookingId, rating, text }: verified user, own completed journey, once per journey. */
export async function create(req: Request, res: Response) {
  validate(req.body, { bookingId: { type: 'string', required: true } });
  const content = checkContent(req.body, false);
  const userId = req.user!._id;
  if (!isObjectId(req.body.bookingId)) throw notFound('REVIEW_BOOKING_NOT_FOUND', 'Booking not found');
  await completeArrivedBookings(new Date(), { _id: req.body.bookingId });
  const booking = await Booking.findOne({ _id: req.body.bookingId, user: userId }).lean();
  // Someone else's booking looks the same as a missing one.
  if (!booking) throw notFound('REVIEW_BOOKING_NOT_FOUND', 'Booking not found');
  if (booking.status !== 'completed') throw conflict('REVIEW_NOT_COMPLETED', 'You can review a route only after completing the journey');
  if (await Review.exists({ booking: booking._id })) throw conflict('REVIEW_ALREADY_EXISTS', 'You already reviewed this journey');

  const now = new Date();
  let review;
  try {
    review = await Review.create({
      user: userId,
      route: booking.route,
      trip: booking.trip,
      booking: booking._id,
      rating: content.rating,
      text: content.text,
      editableUntil: new Date(now.getTime() + REVIEW_EDIT_WINDOW_MS),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('REVIEW_ALREADY_EXISTS', 'You already reviewed this journey');
    throw err;
  }
  const summary = await recomputeRouteRating(booking.route);
  res.status(201).json({ review: await viewOne(review._id, String(userId)), summary });
}

/** PATCH /reviews/:id { rating?, text? }: the author only, within 24 h of posting. */
export async function update(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
  const review = await Review.findById(req.params.id);
  if (!review) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
  if (String(review.user) !== String(req.user!._id)) throw forbidden('REVIEW_NOT_AUTHOR', 'Only the author can edit this review');
  if (review.status === 'removed') throw conflict('REVIEW_REMOVED', 'This review was removed by a moderator');
  if (new Date() >= review.editableUntil) throw forbidden('REVIEW_EDIT_WINDOW_CLOSED', 'Reviews can only be edited within 24 hours');
  const content = checkContent(req.body ?? {}, true);
  // Conditional write: the window is checked again atomically, so a late request can't slip through.
  const updated = await Review.findOneAndUpdate(
    { _id: review._id, editableUntil: { $gt: new Date() }, status: { $ne: 'removed' } },
    { $set: { ...content, editedAt: new Date() } },
    { new: true },
  );
  if (!updated) throw forbidden('REVIEW_EDIT_WINDOW_CLOSED', 'Reviews can only be edited within 24 hours');
  const summary = await recomputeRouteRating(updated.route);
  res.json({ review: await viewOne(updated._id, String(req.user!._id)), summary });
}

/** POST /reviews/:id/report { reason, note? }: once per user, not your own; hidden at the threshold. */
export async function report(req: Request, res: Response) {
  validate(req.body, { reason: { type: 'string', required: true, enum: REPORT_REASONS }, note: { type: 'string', max: 300 } });
  const review = await loadVisible(req.params.id);
  const userId = req.user!._id;
  if (String(review.user) === String(userId)) throw forbidden('REVIEW_REPORT_OWN', 'You cannot report your own review');
  const added = await Review.updateOne(
    { _id: review._id, 'reports.user': { $ne: userId } },
    { $push: { reports: { user: userId, reason: req.body.reason, note: req.body.note?.trim() || undefined } }, $inc: { reportCount: 1 } },
  );
  if (!added.modifiedCount) throw conflict('REVIEW_ALREADY_REPORTED', 'You already reported this review');
  const hidden = await Review.updateOne(
    { _id: review._id, status: 'visible', reportCount: { $gte: REVIEW_HIDE_THRESHOLD } },
    { $set: { status: 'hidden', moderation: { reason: 'reports', auto: true, at: new Date() } } },
  );
  if (hidden.modifiedCount) await recomputeRouteRating(review.route);
  res.json({ reported: true, hidden: hidden.modifiedCount > 0 });
}

/** POST /reviews/:id/helpful: toggles the viewer's helpful vote (not on your own review). */
export async function toggleHelpful(req: Request, res: Response) {
  const review = await loadVisible(req.params.id);
  const userId = req.user!._id;
  if (String(review.user) === String(userId)) throw forbidden('REVIEW_HELPFUL_OWN', 'You cannot vote on your own review');
  let updated = await Review.findOneAndUpdate(
    { _id: review._id, helpfulBy: { $ne: userId } },
    { $push: { helpfulBy: userId }, $inc: { helpfulCount: 1 } },
    { new: true },
  );
  let helpful = true;
  if (!updated) {
    updated = await Review.findOneAndUpdate({ _id: review._id, helpfulBy: userId }, { $pull: { helpfulBy: userId }, $inc: { helpfulCount: -1 } }, { new: true });
    helpful = false;
  }
  await recordReaction(userId, 'review_helpful', review._id, helpful);
  res.json({ helpful, helpfulCount: updated?.helpfulCount ?? review.helpfulCount });
}

/** GET /reviews/eligible: completed journeys not reviewed yet, plus the user's reviews and time left to edit. */
export async function eligible(req: Request, res: Response) {
  const userId = req.user!._id;
  await completeArrivedBookings(new Date(), { user: userId });
  const [completed, mine] = await Promise.all([
    Booking.find({ user: userId, status: 'completed' }).sort({ 'journey.departureTime': -1 }).limit(100).lean(),
    Review.find({ user: userId }).sort({ createdAt: -1 }).populate('route', 'from to').lean(),
  ]);
  const reviewed = new Set(mine.map((r) => String(r.booking)));
  const now = Date.now();
  res.json({
    eligible: completed
      .filter((b) => !reviewed.has(String(b._id)))
      .map((b) => ({
        bookingId: String(b._id),
        pnr: b.pnr,
        routeId: String(b.route),
        from: b.journey.from,
        to: b.journey.to,
        departureTime: b.journey.departureTime,
        operatorName: b.journey.operatorName,
      })),
    reviews: mine.map((r) => {
      const route = r.route as unknown as { _id: Types.ObjectId; from: string; to: string } | null;
      const msLeft = Math.max(0, new Date(r.editableUntil).getTime() - now);
      return {
        id: String(r._id),
        bookingId: String(r.booking),
        routeId: route ? String(route._id) : String(r.route),
        from: route?.from,
        to: route?.to,
        rating: r.rating,
        text: r.text,
        status: r.status,
        createdAt: r.createdAt,
        editedAt: r.editedAt ?? null,
        editableUntil: r.editableUntil,
        editable: msLeft > 0 && r.status !== 'removed',
        editMsLeft: r.status === 'removed' ? 0 : msLeft,
      };
    }),
  });
}

const SORT_SPECS: Record<(typeof REVIEW_SORTS)[number], Record<string, 1 | -1>> = {
  recent: { createdAt: -1, _id: -1 },
  helpful: { helpfulCount: -1, createdAt: -1 },
  highest: { rating: -1, createdAt: -1 },
  lowest: { rating: 1, createdAt: -1 },
};

/** GET /routes/:id/reviews?sort=recent|helpful|highest|lowest&page: visible reviews + rating summary. */
export async function listForRoute(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('ROUTE_NOT_FOUND', 'Route not found');
  const route = await Route.findById(req.params.id).lean();
  if (!route) throw notFound('ROUTE_NOT_FOUND', 'Route not found');
  const { page, limit, skip } = paging(req);
  const sort = REVIEW_SORTS.find((s) => s === req.query.sort) ?? 'recent';
  const filter = { route: route._id, status: 'visible' as const };
  const [items, total, trustedReviewers] = await Promise.all([
    Review.find(filter).sort(SORT_SPECS[sort]).skip(skip).limit(limit).populate('user', 'name').populate('booking', 'journey.departureTime').lean(),
    Review.countDocuments(filter),
    trustedReviewersOfRoute(route._id),
  ]);
  const stats = await reviewerStats(items.map((r) => String((r.user as unknown as { _id: Types.ObjectId })._id)));
  const viewer = viewerOf(req);
  res.json({
    summary: routeSummary(route),
    trustedReviewers,
    reviews: items.map((r) => publicReview(r as never, viewer, stats)),
    total,
    page,
    limit,
    sort,
  });
}

// ---------- Admin moderation

const ADMIN_FILTERS = ['reported', 'hidden', 'removed', 'all'] as const;

/** GET /admin/reviews?filter=reported|hidden|removed|all&routeId=&page= */
export async function adminList(req: Request, res: Response) {
  const { page, limit, skip } = paging(req, 100);
  const kind = ADMIN_FILTERS.find((f) => f === req.query.filter) ?? 'reported';
  const filter: Record<string, unknown> = {};
  if (kind === 'reported') filter.reportCount = { $gt: 0 };
  if (kind === 'hidden' || kind === 'removed') filter.status = kind;
  if (isObjectId(req.query.routeId)) filter.route = req.query.routeId;
  const [items, total] = await Promise.all([
    Review.find(filter)
      .sort(kind === 'reported' ? { reportCount: -1, createdAt: -1 } : { createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email')
      .populate('route', 'from to')
      .populate('reports.user', 'name')
      .populate('moderation.by', 'name')
      .lean(),
    Review.countDocuments(filter),
  ]);
  res.json({
    reviews: items.map((r) => {
      const user = r.user as unknown as { _id: Types.ObjectId; name: string; email: string } | null;
      const route = r.route as unknown as { _id: Types.ObjectId; from: string; to: string } | null;
      const by = r.moderation?.by as unknown as { name: string } | null | undefined;
      return {
        id: String(r._id),
        rating: r.rating,
        text: r.text,
        status: r.status,
        createdAt: r.createdAt,
        editedAt: r.editedAt ?? null,
        user: user ? { id: String(user._id), name: user.name, email: user.email } : null,
        route: route ? { id: String(route._id), from: route.from, to: route.to } : null,
        helpfulCount: r.helpfulCount,
        reportCount: r.reportCount,
        reports: r.reports.map((rep) => ({
          user: (rep.user as unknown as { name?: string } | null)?.name ?? null,
          reason: rep.reason,
          note: rep.note ?? null,
          createdAt: rep.createdAt,
        })),
        moderation: r.moderation?.at
          ? { reason: r.moderation.reason, note: r.moderation.note ?? null, auto: !!r.moderation.auto, by: by?.name ?? null, at: r.moderation.at }
          : null,
      };
    }),
    total,
    page,
    limit,
    filter: kind,
  });
}

async function moderate(req: Request, set: Record<string, unknown>, unset: Record<string, 1> = {}) {
  if (!isObjectId(req.params.id)) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
  const review = await Review.findByIdAndUpdate(req.params.id, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) }, { new: true });
  if (!review) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
  const summary = await recomputeRouteRating(review.route);
  return { review: { id: String(review._id), status: review.status, reportCount: review.reportCount }, summary };
}

/** POST /admin/reviews/:id/hide { note? } */
export async function adminHide(req: Request, res: Response) {
  validate(req.body ?? {}, { note: { type: 'string', max: 300 } });
  res.json(await moderate(req, { status: 'hidden', moderation: { reason: 'moderator', note: req.body?.note?.trim() || undefined, by: req.user!._id, auto: false, at: new Date() } }));
}

/** POST /admin/reviews/:id/remove { reason, note? }: guideline violation, reason required. */
export async function adminRemove(req: Request, res: Response) {
  validate(req.body ?? {}, { reason: { type: 'string', required: true, enum: REMOVE_REASONS }, note: { type: 'string', max: 300 } });
  res.json(await moderate(req, { status: 'removed', moderation: { reason: req.body.reason, note: req.body.note?.trim() || undefined, by: req.user!._id, auto: false, at: new Date() } }));
}

/**
 * POST /admin/reviews/:id/restore { clearReports? = true }
 * Restoring means the admin judged the reports unfounded, so they are cleared unless clearReports is false.
 */
export async function adminRestore(req: Request, res: Response) {
  validate(req.body ?? {}, { clearReports: { type: 'boolean' } });
  const clear = req.body?.clearReports !== false;
  res.json(await moderate(req, { status: 'visible', ...(clear && { reports: [], reportCount: 0 }) }, { moderation: 1 }));
}
