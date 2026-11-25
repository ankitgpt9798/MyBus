import { Types } from 'mongoose';
import { Review, ReviewAttrs } from '../models/Review';
import { Route } from '../models/Route';
import { User } from '../models/User';
import { TRUSTED_MIN_HELPFUL, TRUSTED_MIN_REVIEWS } from './review.rules';

export type Distribution = Record<'1' | '2' | '3' | '4' | '5', number>;
export interface RatingSummary {
  avg: number;
  count: number;
  distribution: Distribution;
}
type Id = Types.ObjectId | string;

const emptyDistribution = (): Distribution => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

/**
 * Recomputes a route's average (1 decimal), count and 1-5 distribution from its VISIBLE reviews.
 * Uses an aggregation over the current data instead of increments, so concurrent changes can't drift it.
 */
export async function recomputeRouteRating(routeId: Id): Promise<RatingSummary> {
  const rows: { _id: number; n: number }[] = await Review.aggregate([
    { $match: { route: new Types.ObjectId(String(routeId)), status: 'visible' } },
    { $group: { _id: '$rating', n: { $sum: 1 } } },
  ]);
  const distribution = emptyDistribution();
  let count = 0;
  let total = 0;
  for (const r of rows) {
    distribution[String(r._id) as keyof Distribution] = r.n;
    count += r.n;
    total += r._id * r.n;
  }
  const avg = count ? Math.round((total / count) * 10) / 10 : 0;
  await Route.updateOne({ _id: routeId }, { $set: { ratingAvg: avg, ratingCount: count, ratingDistribution: distribution } });
  return { avg, count, distribution };
}

export function routeSummary(route: { ratingAvg?: number | null; ratingCount?: number | null; ratingDistribution?: unknown }): RatingSummary {
  return { avg: route.ratingAvg ?? 0, count: route.ratingCount ?? 0, distribution: { ...emptyDistribution(), ...((route.ratingDistribution as Distribution) ?? {}) } };
}

export interface ReviewerStats {
  reviews: number;
  helpful: number;
  trusted: boolean;
}

/** Visible-review totals per user; trusted = TRUSTED_MIN_HELPFUL votes across TRUSTED_MIN_REVIEWS reviews. */
export async function reviewerStats(userIds: Id[]): Promise<Map<string, ReviewerStats>> {
  const ids = [...new Set(userIds.map(String))].map((id) => new Types.ObjectId(id));
  const rows: { _id: Types.ObjectId; reviews: number; helpful: number }[] = ids.length
    ? await Review.aggregate([
        { $match: { user: { $in: ids }, status: 'visible' } },
        { $group: { _id: '$user', reviews: { $sum: 1 }, helpful: { $sum: '$helpfulCount' } } },
      ])
    : [];
  const map = new Map<string, ReviewerStats>();
  for (const r of rows) {
    map.set(String(r._id), { reviews: r.reviews, helpful: r.helpful, trusted: r.helpful >= TRUSTED_MIN_HELPFUL && r.reviews >= TRUSTED_MIN_REVIEWS });
  }
  return map;
}

/** Public display name: first name + last initial ("Priya Sharma" → "Priya S."). Never the email. */
export function displayName(name: string | undefined | null): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Traveller';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : parts[0];
}

type ReviewLean = ReviewAttrs & { _id: Types.ObjectId; createdAt: Date; user: Types.ObjectId | { _id: Types.ObjectId; name: string } };

/** Review as shown on the route page (no emails, no reporter identities). */
export function publicReview(r: ReviewLean, viewerId: string | null, stats: Map<string, ReviewerStats>, now = new Date()) {
  const authorId = String(typeof r.user === 'object' && 'name' in r.user ? r.user._id : r.user);
  const authorName = typeof r.user === 'object' && 'name' in r.user ? r.user.name : '';
  const mine = viewerId === authorId;
  return {
    id: String(r._id),
    routeId: String(r.route),
    rating: r.rating,
    text: r.text,
    createdAt: r.createdAt,
    editedAt: r.editedAt ?? null,
    author: { id: authorId, name: displayName(authorName), isTrustedReviewer: stats.get(authorId)?.trusted ?? false },
    // When the reviewed journey departed (the booking is populated with journey.departureTime only).
    travelledAt: (r.booking as unknown as { journey?: { departureTime?: Date } } | null)?.journey?.departureTime ?? null,
    helpfulCount: r.helpfulCount,
    helpfulByMe: viewerId ? r.helpfulBy.some((u) => String(u) === viewerId) : false,
    reportedByMe: viewerId ? r.reports.some((rep) => String(rep.user) === viewerId) : false,
    mine,
    editable: mine && r.status !== 'removed' && now < r.editableUntil,
    editableUntil: mine ? r.editableUntil : undefined,
  };
}

/** Trusted reviewers among the authors of a route's visible reviews. */
export async function trustedReviewersOfRoute(routeId: Id) {
  const authorIds: Types.ObjectId[] = await Review.distinct('user', { route: routeId, status: 'visible' });
  const stats = await reviewerStats(authorIds);
  const trustedIds = [...stats.entries()].filter(([, s]) => s.trusted).map(([id]) => id);
  if (!trustedIds.length) return [];
  const users = await User.find({ _id: { $in: trustedIds } }).select('name').lean();
  return users
    .map((u) => ({ name: displayName(u.name), reviews: stats.get(String(u._id))!.reviews, helpful: stats.get(String(u._id))!.helpful }))
    .sort((a, b) => b.helpful - a.helpful);
}
