import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Comment } from '../models/Comment';
import { Post } from '../models/Post';
import { Reaction } from '../models/Reaction';
import { Review } from '../models/Review';
import { User } from '../models/User';
import { PostLean, excerpt, hiddenIds, viewPost, visibleCommentFilter } from '../services/community.service';
import { displayName, reviewerStats } from '../services/review.service';
import { badRequest, notFound } from '../utils/AppError';
import { isObjectId } from '../utils/validate';

/**
 * Public profiles (R1): display name, badges, stats and the user's visible posts, comments, reviews and activity.
 * Never an email. The owner also sees their own hidden / removed items, marked with their status.
 */

type Id = Types.ObjectId;
type RouteRef = { _id: Id; from: string; to: string } | null;
type PostRef = { _id: Id; title: string; status?: string } | null;

const paging = (req: Request) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10));
  return { page, limit, skip: (page - 1) * limit };
};
const routeView = (r: RouteRef) => (r ? { id: String(r._id), from: r.from, to: r.to } : null);
const postRef = (p: PostRef) => (p ? { id: String(p._id), title: p.title } : null);

async function loadProfile(req: Request) {
  if (!isObjectId(req.params.id)) throw notFound('USER_NOT_FOUND', 'User not found');
  const user = await User.findById(req.params.id).select('name emailVerified createdAt').lean();
  if (!user) throw notFound('USER_NOT_FOUND', 'User not found');
  const viewer = req.user ? String(req.user._id) : null;
  return { user, viewer, own: viewer === String(user._id) };
}

/** GET /users/:id/profile */
export async function profile(req: Request, res: Response) {
  const { user, own } = await loadProfile(req);
  const hidden = await hiddenIds();
  type Sum = { n: number; likes: number }[];
  const [posts, comments, reviews]: [Sum, Sum, Awaited<ReturnType<typeof reviewerStats>>] = await Promise.all([
    Post.aggregate([{ $match: { author: user._id, status: 'visible' as const } }, { $group: { _id: null, n: { $sum: 1 }, likes: { $sum: '$likeCount' } } }]),
    Comment.aggregate([{ $match: { author: user._id, ...visibleCommentFilter(hidden) } }, { $group: { _id: null, n: { $sum: 1 }, likes: { $sum: '$likeCount' } } }]),
    reviewerStats([user._id]),
  ]);
  const rs = reviews.get(String(user._id));
  res.json({
    user: { id: String(user._id), name: displayName(user.name), memberSince: user.createdAt, verified: !!user.emailVerified, trustedReviewer: rs?.trusted ?? false },
    stats: {
      posts: posts[0]?.n ?? 0,
      comments: comments[0]?.n ?? 0,
      likesReceived: (posts[0]?.likes ?? 0) + (comments[0]?.likes ?? 0),
      reviews: rs?.reviews ?? 0,
      helpfulReceived: rs?.helpful ?? 0,
    },
    own,
  });
}

/** GET /users/:id/posts?page */
export async function posts(req: Request, res: Response) {
  const { user, viewer, own } = await loadProfile(req);
  const { page, limit, skip } = paging(req);
  const filter = own ? { author: user._id } : { author: user._id, status: 'visible' as const };
  const [rows, total] = await Promise.all([
    Post.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'author', select: 'name' },
        { path: 'route', select: 'from to' },
      ])
      .lean(),
    Post.countDocuments(filter),
  ]);
  res.json({ posts: rows.map((p) => viewPost(p as unknown as PostLean, viewer, false)), total, page, limit });
}

/** GET /users/:id/comments?page: each with the post it belongs to. */
export async function comments(req: Request, res: Response) {
  const { user, own } = await loadProfile(req);
  const { page, limit, skip } = paging(req);
  const filter = own ? { author: user._id } : { author: user._id, ...visibleCommentFilter(await hiddenIds()) };
  const [rows, total] = await Promise.all([
    Comment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('post', 'title status').lean(),
    Comment.countDocuments(filter),
  ]);
  res.json({
    comments: rows.map((c) => ({
      id: String(c._id),
      body: excerpt(c.body, 280),
      reply: !!c.parent,
      likeCount: c.likeCount,
      status: c.status,
      post: postRef(c.post as unknown as PostRef),
      createdAt: c.createdAt,
    })),
    total,
    page,
    limit,
  });
}

/** GET /users/:id/reviews?page: each with the route it is about. */
export async function reviews(req: Request, res: Response) {
  const { user, own } = await loadProfile(req);
  const { page, limit, skip } = paging(req);
  const filter = own ? { user: user._id } : { user: user._id, status: 'visible' as const };
  const [rows, total] = await Promise.all([
    Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('route', 'from to').lean(),
    Review.countDocuments(filter),
  ]);
  res.json({
    reviews: rows.map((r) => ({
      id: String(r._id),
      rating: r.rating,
      text: excerpt(r.text, 300),
      helpfulCount: r.helpfulCount,
      status: r.status,
      route: routeView(r.route as unknown as RouteRef),
      createdAt: r.createdAt,
    })),
    total,
    page,
    limit,
  });
}

/**
 * GET /users/:id/activity?before=<ISO date>&limit=15
 * Posts, comments, reviews, likes given and helpful votes, newest first. Each source is read up to `limit`
 * items before the cursor; only items newer than the oldest item of a full source are returned, so nothing
 * is skipped between pages. Likes and votes are shown only while the content they point to is visible.
 */
export async function activity(req: Request, res: Response) {
  const { user, own } = await loadProfile(req);
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 15));
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  if (before && Number.isNaN(before.getTime())) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'before', rule: 'date' }]);
  const at = before ? { createdAt: { $lt: before } } : {};
  const hidden = await hiddenIds();
  const visibleComments = visibleCommentFilter(hidden);
  const uid = user._id;

  const [myPosts, myComments, myReviews, reactions] = await Promise.all([
    Post.find({ author: uid, ...(own ? {} : { status: 'visible' }), ...at }).sort({ createdAt: -1 }).limit(limit).select('title status createdAt').lean(),
    Comment.find({ author: uid, ...(own ? {} : visibleComments), ...at }).sort({ createdAt: -1 }).limit(limit).select('body post parent status createdAt').populate('post', 'title').lean(),
    Review.find({ user: uid, ...(own ? {} : { status: 'visible' }), ...at }).sort({ createdAt: -1 }).limit(limit).select('rating route status createdAt').populate('route', 'from to').lean(),
    Reaction.find({ user: uid, ...at }).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);

  const targets = (kind: string) => reactions.filter((r) => r.kind === kind).map((r) => r.target);
  const [likedComments, votedReviews] = await Promise.all([
    Comment.find({ _id: { $in: targets('comment_like') }, ...visibleComments }).select('post').lean(),
    Review.find({ _id: { $in: targets('review_helpful') }, status: 'visible' }).select('route').populate('route', 'from to').lean(),
  ]);
  const likedPosts = await Post.find({ _id: { $in: [...targets('post_like'), ...likedComments.map((c) => c.post)] }, status: 'visible' }).select('title').lean();
  const findPost = (id: unknown) => likedPosts.find((p) => String(p._id) === String(id));

  type Item = { key: string; type: string; at: Date; status?: string; [k: string]: unknown };
  const items: Item[] = [
    ...myPosts.map((p) => ({ key: `post:${p._id}`, type: 'post', at: p.createdAt, status: p.status, post: postRef(p as unknown as PostRef) })),
    ...myComments
      .filter((c) => c.post)
      .map((c) => ({ key: `comment:${c._id}`, type: 'comment', at: c.createdAt, status: c.status, text: excerpt(c.body, 160), reply: !!c.parent, post: postRef(c.post as unknown as PostRef) })),
    ...myReviews.map((r) => ({ key: `review:${r._id}`, type: 'review', at: r.createdAt, status: r.status, rating: r.rating, route: routeView(r.route as unknown as RouteRef) })),
  ];
  for (const r of reactions) {
    if (r.kind === 'post_like' && findPost(r.target)) items.push({ key: `like:${r._id}`, type: 'like_post', at: r.createdAt, post: postRef(findPost(r.target) as PostRef) });
    if (r.kind === 'comment_like') {
      const c = likedComments.find((x) => String(x._id) === String(r.target));
      if (c && findPost(c.post)) items.push({ key: `like:${r._id}`, type: 'like_comment', at: r.createdAt, post: postRef(findPost(c.post) as PostRef) });
    }
    if (r.kind === 'review_helpful') {
      const v = votedReviews.find((x) => String(x._id) === String(r.target));
      if (v) items.push({ key: `helpful:${r._id}`, type: 'helpful', at: r.createdAt, route: routeView(v.route as unknown as RouteRef) });
    }
  }

  const fullSources = [myPosts, myComments, myReviews, reactions].filter((list) => list.length === limit);
  const horizon = fullSources.length ? Math.max(...fullSources.map((list) => new Date(list[list.length - 1].createdAt).getTime())) : -Infinity;
  const ready = items.filter((i) => new Date(i.at).getTime() >= horizon).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const page = ready.slice(0, limit);
  const next = ready.length > limit ? page[page.length - 1].at : Number.isFinite(horizon) ? new Date(horizon) : null;
  res.json({ items: page.map(({ status, ...i }) => ({ ...i, ...(status && status !== 'visible' && { status }) })), next });
}
