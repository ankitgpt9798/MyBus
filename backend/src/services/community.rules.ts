/** Community moderation, sharing and popularity rules (R1). */

/** Distinct reports after which a post or comment is hidden automatically until an admin looks at it. */
export const COMMUNITY_HIDE_THRESHOLD = 3;
export const COMMUNITY_REPORT_REASONS = ['spam', 'offensive', 'irrelevant', 'misleading', 'other'] as const;
export const COMMUNITY_REMOVE_REASONS = ['spam', 'offensive', 'irrelevant', 'misleading', 'personal_info', 'other'] as const;

/** Where a post can be shared to; also the utm_source values that count a visit back. */
export const SHARE_NETWORKS = ['whatsapp', 'x', 'facebook', 'telegram', 'copy', 'native'] as const;
export type ShareNetwork = (typeof SHARE_NETWORKS)[number];
export const UTM = { medium: 'social', campaign: 'community' } as const;
/** The same visitor (IP) sharing or arriving from the same network again within this window is not counted twice. */
export const SHARE_DEDUPE_MS = 10 * 60 * 1000;
/** Share and visit tracking calls allowed per IP per minute. */
export const SHARE_BURST_PER_MINUTE = 30;

/** Engagement points: likes + 2 × comments + 3 × shares. */
export const ENGAGEMENT_WEIGHTS = { like: 1, comment: 2, share: 3 } as const;
/** Trending: a post's engagement counts half as much every 72 hours of its age, so recent activity ranks higher. */
export const TRENDING_HALF_LIFE_HOURS = 72;
/** "Trending this week" only looks at posts from the last 7 days. */
export const TRENDING_WINDOW_DAYS = 7;
/** Posts with at least this many engagement points get the Popular badge. */
export const POPULAR_MIN_ENGAGEMENT = 15;
/** Top contributors: points for visible posts and comments in the last 30 days plus the likes they received. */
export const CONTRIBUTOR_WINDOW_DAYS = 30;
export const CONTRIBUTOR_WEIGHTS = { post: 5, comment: 2, likeReceived: 1 } as const;

const HOUR_MS = 60 * 60 * 1000;

interface Engaged {
  likeCount?: number | null;
  commentCount?: number | null;
  shareCount?: number | null;
}

export function engagement(p: Engaged): number {
  return ENGAGEMENT_WEIGHTS.like * (p.likeCount ?? 0) + ENGAGEMENT_WEIGHTS.comment * (p.commentCount ?? 0) + ENGAGEMENT_WEIGHTS.share * (p.shareCount ?? 0);
}

/** score = engagement × 0.5 ^ (age in hours / 72) */
export function trendingScore(p: Engaged & { createdAt: Date | string }, now = new Date()): number {
  const ageHours = Math.max(0, now.getTime() - new Date(p.createdAt).getTime()) / HOUR_MS;
  return engagement(p) * 0.5 ** (ageHours / TRENDING_HALF_LIFE_HOURS);
}

/** trendingScore() as a MongoDB expression, so the feed can be sorted by it in the database. */
export function trendingScoreExpr(now: Date) {
  const points = {
    $add: [
      { $multiply: [ENGAGEMENT_WEIGHTS.like, { $ifNull: ['$likeCount', 0] }] },
      { $multiply: [ENGAGEMENT_WEIGHTS.comment, { $ifNull: ['$commentCount', 0] }] },
      { $multiply: [ENGAGEMENT_WEIGHTS.share, { $ifNull: ['$shareCount', 0] }] },
    ],
  };
  const ageHours = { $divide: [{ $max: [0, { $subtract: [now, '$createdAt'] }] }, HOUR_MS] };
  return { $multiply: [points, { $pow: [0.5, { $divide: [ageHours, TRENDING_HALF_LIFE_HOURS] }] }] };
}
