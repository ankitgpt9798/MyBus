import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { isLang } from '../i18n';
import { Comment } from '../models/Comment';
import { BOARDS, Post, PostDoc } from '../models/Post';
import { Route } from '../models/Route';
import { User } from '../models/User';
import {
  COMMUNITY_HIDE_THRESHOLD,
  COMMUNITY_REMOVE_REASONS,
  COMMUNITY_REPORT_REASONS,
  CONTRIBUTOR_WEIGHTS,
  CONTRIBUTOR_WINDOW_DAYS,
  SHARE_BURST_PER_MINUTE,
  SHARE_DEDUPE_MS,
  SHARE_NETWORKS,
  TRENDING_WINDOW_DAYS,
  trendingScoreExpr,
} from '../services/community.rules';
import {
  AuthorRef,
  PostLean,
  authorView,
  excerpt,
  forgetReactions,
  hiddenIds,
  recordReaction,
  syncCommentCount,
  viewPost,
  visibleCommentFilter,
} from '../services/community.service';
import { guidelineViolation } from '../services/review.rules';
import { displayName } from '../services/review.service';
import { StoredPhoto, photoKey, removePhotos, storeImages } from '../services/photo-storage.service';
import { MAX_PHOTOS, checkPhotos } from '../services/upload.service';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/AppError';
import { allow } from '../utils/rate-limit';
import { isObjectId, validate } from '../utils/validate';

export const POST_TITLE = { min: 5, max: 120 };
export const POST_BODY = { min: 20, max: 5000 };
export const COMMENT_BODY = { min: 2, max: 1000 };
const ALT_MAX = 150;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_CONTRIBUTORS = 5;
const SORTS = { latest: { createdAt: -1 }, top: { likeCount: -1, createdAt: -1 }, discussed: { commentCount: -1, createdAt: -1 }, trending: null } as const;

type Id = Types.ObjectId;

const viewerOf = (req: Request) => (req.user ? String(req.user._id) : null);
const paging = (req: Request, max = 30) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(max, Math.max(1, Number(req.query.limit) || 10));
  return { page, limit, skip: (page - 1) * limit };
};
const withRefs = [
  { path: 'author', select: 'name' },
  { path: 'route', select: 'from to' },
];

/** Links are not allowed in community content either (spam and phishing); same rules as reviews. */
function checkGuidelines(fields: Record<string, string | undefined>) {
  for (const [field, text] of Object.entries(fields)) {
    const rule = text ? guidelineViolation(text) : null;
    if (rule) throw badRequest('CONTENT_GUIDELINES', 'The text breaks the community guidelines', [{ field, rule }]);
  }
}

async function cityList(): Promise<string[]> {
  const [from, to] = await Promise.all([Route.distinct('from'), Route.distinct('to')]);
  return [...new Set([...from, ...to])];
}

/** Validates post fields (all optional when editing) and resolves the route / city tags. */
async function readPostInput(body: Record<string, unknown>, partial: boolean) {
  const cities = await cityList();
  validate(body, {
    board: { type: 'string', required: !partial, enum: BOARDS },
    title: { type: 'string', required: !partial, min: POST_TITLE.min, max: POST_TITLE.max },
    body: { type: 'string', required: !partial, min: POST_BODY.min, max: POST_BODY.max },
    city: { type: 'string', enum: ['', ...cities] },
    routeId: { type: 'string' },
  });
  const out: { board?: string; title?: string; body?: string; route?: Id | null; city?: string | null } = {};
  if (body.board !== undefined) out.board = String(body.board);
  if (body.title !== undefined) out.title = String(body.title).trim();
  if (body.body !== undefined) out.body = String(body.body).replace(/\r\n/g, '\n').trim();
  if (body.city !== undefined) out.city = String(body.city) || null;
  if (body.routeId !== undefined) {
    const id = String(body.routeId);
    if (!id) out.route = null;
    else {
      const route = isObjectId(id) ? await Route.findById(id).select('_id').lean() : null;
      if (!route) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'routeId', rule: 'invalid' }]);
      out.route = route._id;
    }
  }
  checkGuidelines({ title: out.title, body: out.body });
  return out;
}

/** The Routes board needs a route tag and the Destinations board a city. */
function checkBoardTags(board: string, route: unknown, city: unknown) {
  if (board === 'routes' && !route) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'routeId', rule: 'required' }]);
  if (board === 'destinations' && !city) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'city', rule: 'required' }]);
}

/** Optional alt texts sent as a JSON array of strings (one per new photo). */
function readAlts(raw: unknown, count: number): string[] {
  let list: unknown = [];
  try {
    list = raw ? JSON.parse(String(raw)) : [];
  } catch {
    list = [];
  }
  const alts = Array.isArray(list) ? list.map((a) => String(a ?? '').trim()) : [];
  if (alts.some((a) => a.length > ALT_MAX)) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'alts', rule: 'maxlength', params: { max: ALT_MAX } }]);
  return Array.from({ length: count }, (_, i) => alts[i] ?? '');
}

async function loadVisiblePost(id: unknown) {
  if (!isObjectId(id)) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  const post = await Post.findById(id);
  if (!post || post.status !== 'visible') throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  return post;
}

/** A visible comment on a visible post. */
async function loadVisibleComment(id: unknown) {
  if (!isObjectId(id)) throw notFound('COMMUNITY_COMMENT_NOT_FOUND', 'Comment not found');
  const comment = await Comment.findById(id);
  if (!comment || comment.status !== 'visible' || !(await Post.exists({ _id: comment.post, status: 'visible' }))) {
    throw notFound('COMMUNITY_COMMENT_NOT_FOUND', 'Comment not found');
  }
  return comment;
}

async function postView(id: Id, viewer: string | null) {
  const p = await Post.findById(id).populate(withRefs).lean();
  return viewPost(p as unknown as PostLean, viewer, true);
}

// ---------- Boards, feed and highlights (public)

/** GET /community/boards: the fixed boards with their number of posts and latest activity. */
export async function boards(_req: Request, res: Response) {
  const rows: { _id: string; posts: number; latest: Date }[] = await Post.aggregate([
    { $match: { status: 'visible' } },
    { $group: { _id: '$board', posts: { $sum: 1 }, latest: { $max: '$createdAt' } } },
  ]);
  res.json({ boards: BOARDS.map((id) => ({ id, posts: rows.find((r) => r._id === id)?.posts ?? 0, latestAt: rows.find((r) => r._id === id)?.latest ?? null })) });
}

/** GET /community/posts?board&routeId&city&sort=latest|top|discussed|trending&page */
export async function listPosts(req: Request, res: Response) {
  const { page, limit, skip } = paging(req);
  const filter: Record<string, unknown> = { status: 'visible' };
  const board = BOARDS.find((b) => b === req.query.board);
  if (board) filter.board = board;
  if (isObjectId(req.query.routeId)) filter.route = new Types.ObjectId(String(req.query.routeId));
  if (typeof req.query.city === 'string' && req.query.city) filter.city = req.query.city;
  const sortKey = (Object.keys(SORTS) as (keyof typeof SORTS)[]).find((s) => s === req.query.sort) ?? 'latest';
  const spec = SORTS[sortKey];
  const [items, total] = await Promise.all([
    spec
      ? Post.find(filter).sort(spec).skip(skip).limit(limit).populate(withRefs).lean()
      : Post.aggregate([
          { $match: filter },
          { $addFields: { score: trendingScoreExpr(new Date()) } },
          { $sort: { score: -1, createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
        ]).then((rows) => Post.populate(rows, withRefs)),
    Post.countDocuments(filter),
  ]);
  const viewer = viewerOf(req);
  res.json({ posts: items.map((p) => viewPost(p as unknown as PostLean, viewer, false)), total, page, limit, sort: sortKey });
}

/** GET /community/trending?limit=4: posts from the last 7 days with the highest trending score. */
export async function trending(req: Request, res: Response) {
  const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 4));
  const now = new Date();
  const rows = await Post.aggregate([
    { $match: { status: 'visible', createdAt: { $gte: new Date(now.getTime() - TRENDING_WINDOW_DAYS * DAY_MS) } } },
    { $addFields: { score: trendingScoreExpr(now) } },
    { $match: { score: { $gt: 0 } } },
    { $sort: { score: -1, createdAt: -1, _id: -1 } },
    { $limit: limit },
  ]);
  const posts = await Post.populate(rows, withRefs);
  const viewer = viewerOf(req);
  res.json({ posts: posts.map((p) => viewPost(p as unknown as PostLean, viewer, false)) });
}

/** GET /community/contributors: most engaged members of the last 30 days (posts, comments, likes received). */
export async function contributors(_req: Request, res: Response) {
  const since = new Date(Date.now() - CONTRIBUTOR_WINDOW_DAYS * DAY_MS);
  const hidden = await hiddenIds();
  type Row = { _id: Id; n: number; likes: number };
  const [posts, comments]: [Row[], Row[]] = await Promise.all([
    Post.aggregate([{ $match: { status: 'visible', createdAt: { $gte: since } } }, { $group: { _id: '$author', n: { $sum: 1 }, likes: { $sum: '$likeCount' } } }]),
    Comment.aggregate([{ $match: { ...visibleCommentFilter(hidden), createdAt: { $gte: since } } }, { $group: { _id: '$author', n: { $sum: 1 }, likes: { $sum: '$likeCount' } } }]),
  ]);
  const totals = new Map<string, { posts: number; comments: number; likesReceived: number }>();
  const entry = (id: Id) => {
    if (!totals.has(String(id))) totals.set(String(id), { posts: 0, comments: 0, likesReceived: 0 });
    return totals.get(String(id))!;
  };
  for (const r of posts) {
    entry(r._id).posts = r.n;
    entry(r._id).likesReceived += r.likes;
  }
  for (const r of comments) {
    entry(r._id).comments = r.n;
    entry(r._id).likesReceived += r.likes;
  }
  const ranked = [...totals.entries()]
    .map(([id, t]) => ({ id, ...t, points: CONTRIBUTOR_WEIGHTS.post * t.posts + CONTRIBUTOR_WEIGHTS.comment * t.comments + CONTRIBUTOR_WEIGHTS.likeReceived * t.likesReceived }))
    .sort((a, b) => b.points - a.points || b.posts - a.posts)
    .slice(0, TOP_CONTRIBUTORS);
  const users = await User.find({ _id: { $in: ranked.map((r) => r.id) } }).select('name').lean();
  res.json({
    contributors: ranked
      .map((r) => ({ ...r, name: displayName(users.find((u) => String(u._id) === r.id)?.name) }))
      .filter((r) => users.some((u) => String(u._id) === r.id)),
    days: CONTRIBUTOR_WINDOW_DAYS,
  });
}

/**
 * GET /community/posts/:id: the post with its comments (replies nested one level).
 * A hidden or removed post is shown only to its author (with the moderation notice) and to admins.
 */
export async function getPost(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  const post = await Post.findById(req.params.id).select('author status').lean();
  const viewer = viewerOf(req);
  const privileged = !!post && (String(post.author) === viewer || req.user?.role === 'admin');
  if (!post || (post.status !== 'visible' && !privileged)) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  const [view, comments] = await Promise.all([
    postView(post._id, viewer),
    Comment.find({ post: post._id, status: 'visible' }).sort({ createdAt: 1 }).limit(1000).populate('author', 'name').lean(),
  ]);
  const toView = (c: (typeof comments)[number]) => ({
    id: String(c._id),
    parentId: c.parent ? String(c.parent) : null,
    body: c.body,
    author: authorView(c.author as unknown as AuthorRef),
    likeCount: c.likeCount,
    likedByMe: viewer ? c.likedBy.some((u) => String(u) === viewer) : false,
    reportedByMe: viewer ? c.reports.some((r) => String(r.user) === viewer) : false,
    mine: !!viewer && String((c.author as unknown as AuthorRef)?._id) === viewer,
    createdAt: c.createdAt,
  });
  const top = comments.filter((c) => !c.parent).map((c) => ({ ...toView(c), replies: [] as ReturnType<typeof toView>[] }));
  for (const c of comments.filter((x) => x.parent)) top.find((t) => t.id === String(c.parent))?.replies.push(toView(c));
  res.json({ post: view, comments: top });
}

// ---------- Posts (verified users)

/** POST /community/posts (multipart: board, title, body, routeId?, city?, alts?, language?, photos[] ≤ 4) */
export async function createPost(req: Request, res: Response) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const input = await readPostInput(req.body ?? {}, false);
  checkBoardTags(input.board!, input.route, input.city);
  const types = checkPhotos(files);
  const alts = readAlts(req.body?.alts, files.length);
  const language = isLang(req.body?.language) ? req.body.language : req.user!.language;
  const saved = await storeImages(files.map((f, i) => ({ data: f.buffer, type: types[i] })));
  let post: PostDoc;
  try {
    post = await Post.create({
      author: req.user!._id,
      board: input.board as (typeof BOARDS)[number],
      title: input.title,
      body: input.body,
      route: input.route ?? undefined,
      city: input.city ?? undefined,
      language,
      photos: saved.map((s, i) => ({ ...s, alt: alts[i] })),
    });
  } catch (err) {
    await removePhotos(saved);
    throw err;
  }
  res.status(201).json({ post: await postView(post._id, viewerOf(req)) });
}

/**
 * PATCH /community/posts/:id (multipart): any post field, plus
 *  keep: JSON [{ file, alt }] of existing photos to keep (all kept when omitted; `file` is the photo id from the API)
 *  and new photos[].
 */
export async function updatePost(req: Request, res: Response) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!isObjectId(req.params.id)) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  const post = await Post.findById(req.params.id);
  if (!post) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  if (String(post.author) !== String(req.user!._id)) throw forbidden('COMMUNITY_NOT_AUTHOR', 'Only the author can change this post');
  if (post.status === 'removed') throw conflict('COMMUNITY_POST_REMOVED', 'This post was removed by a moderator');

  const input = await readPostInput(req.body ?? {}, true);
  const board = input.board ?? post.board;
  const route = input.route === undefined ? post.route : input.route;
  const city = input.city === undefined ? post.city : input.city;
  checkBoardTags(board, route, city);

  // Photos: kept existing ones (optionally with new alt text) + new uploads, at most 4 in total.
  const current = (post.toObject().photos ?? []) as StoredPhoto[];
  let kept = current.map((p) => ({ ...p, alt: p.alt ?? '' }));
  if (req.body?.keep !== undefined) {
    let list: unknown;
    try {
      list = JSON.parse(String(req.body.keep));
    } catch {
      list = null;
    }
    if (!Array.isArray(list)) throw badRequest('VALIDATION_ERROR', 'Invalid input', [{ field: 'keep', rule: 'type' }]);
    const wanted = list as { file?: string; alt?: string }[];
    kept = kept
      .filter((p) => wanted.some((w) => w.file === photoKey(p)))
      .map((p) => ({ ...p, alt: String(wanted.find((w) => w.file === photoKey(p))?.alt ?? p.alt).trim().slice(0, ALT_MAX) }));
  }
  if (kept.length + files.length > MAX_PHOTOS) {
    throw new AppError(400, 'COMMUNITY_TOO_MANY_PHOTOS', 'At most 4 photos per post', [{ field: 'photos', rule: 'maxItems', params: { max: MAX_PHOTOS } }]);
  }
  const types = checkPhotos(files);
  const alts = readAlts(req.body?.alts, files.length);
  const dropped = current.filter((p) => !kept.some((k) => photoKey(k) === photoKey(p)));
  const saved = await storeImages(files.map((f, i) => ({ data: f.buffer, type: types[i] })));
  try {
    await Post.updateOne(
      { _id: post._id },
      {
        $set: {
          board,
          title: input.title ?? post.title,
          body: input.body ?? post.body,
          route: route ?? undefined,
          city: city ?? undefined,
          photos: [...kept, ...saved.map((s, i) => ({ ...s, alt: alts[i] }))],
          editedAt: new Date(),
        },
        ...((!route || !city) && { $unset: { ...(!route && { route: 1 }), ...(!city && { city: 1 }) } }),
      },
    );
  } catch (err) {
    await removePhotos(saved);
    throw err;
  }
  await removePhotos(dropped);
  res.json({ post: await postView(post._id, viewerOf(req)) });
}

/** DELETE /community/posts/:id: the author removes their post, its comments and its photos (files or Cloudinary images). */
export async function deletePost(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  const post = await Post.findById(req.params.id);
  if (!post) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  if (String(post.author) !== String(req.user!._id)) throw forbidden('COMMUNITY_NOT_AUTHOR', 'Only the author can delete this post');
  const commentIds = (await Comment.distinct('_id', { post: post._id })) as Id[];
  await Comment.deleteMany({ post: post._id });
  await Post.deleteOne({ _id: post._id });
  await forgetReactions([post._id, ...commentIds]);
  await removePhotos((post.toObject().photos ?? []) as StoredPhoto[]);
  res.json({ deleted: true });
}

/** Atomic like toggle shared by posts and comments: add the vote if absent, otherwise take it back. */
async function toggleLike(model: typeof Post | typeof Comment, id: Id, userId: Id) {
  const M = model as typeof Post;
  let doc = await M.findOneAndUpdate({ _id: id, likedBy: { $ne: userId } }, { $push: { likedBy: userId }, $inc: { likeCount: 1 } }, { new: true });
  if (doc) return { liked: true, likeCount: doc.likeCount };
  doc = await M.findOneAndUpdate({ _id: id, likedBy: userId }, { $pull: { likedBy: userId }, $inc: { likeCount: -1 } }, { new: true });
  return { liked: false, likeCount: doc?.likeCount ?? 0 };
}

/** POST /community/posts/:id/like */
export async function likePost(req: Request, res: Response) {
  const post = await loadVisiblePost(req.params.id);
  const result = await toggleLike(Post, post._id, req.user!._id);
  await recordReaction(req.user!._id, 'post_like', post._id, result.liked);
  res.json(result);
}

// ---------- Comments (verified users)

/** POST /community/posts/:id/comments { body, parentId? }: replies go one level deep. */
export async function addComment(req: Request, res: Response) {
  const post = await loadVisiblePost(req.params.id);
  validate(req.body, { body: { type: 'string', required: true, min: COMMENT_BODY.min, max: COMMENT_BODY.max }, parentId: { type: 'string' } });
  const body = String(req.body.body).replace(/\r\n/g, '\n').trim();
  checkGuidelines({ body });
  let parent: Id | undefined;
  if (req.body.parentId) {
    const p = isObjectId(req.body.parentId) ? await Comment.findById(req.body.parentId).lean() : null;
    if (!p || String(p.post) !== String(post._id) || p.status !== 'visible') throw notFound('COMMUNITY_COMMENT_NOT_FOUND', 'Comment not found');
    if (p.parent) throw badRequest('COMMUNITY_REPLY_DEPTH', 'Replies can only be added to top-level comments');
    parent = p._id;
  }
  const comment = await Comment.create({ post: post._id, author: req.user!._id, parent, body });
  const commentCount = await syncCommentCount(post._id);
  res.status(201).json({
    comment: {
      id: String(comment._id),
      parentId: parent ? String(parent) : null,
      body: comment.body,
      author: authorView({ _id: req.user!._id, name: req.user!.name }),
      likeCount: 0,
      likedByMe: false,
      reportedByMe: false,
      mine: true,
      createdAt: comment.createdAt,
      replies: [],
    },
    commentCount,
  });
}

/** DELETE /community/comments/:id: the author deletes their comment (and the replies under it). */
export async function deleteComment(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('COMMUNITY_COMMENT_NOT_FOUND', 'Comment not found');
  const comment = await Comment.findById(req.params.id);
  if (!comment) throw notFound('COMMUNITY_COMMENT_NOT_FOUND', 'Comment not found');
  if (String(comment.author) !== String(req.user!._id)) throw forbidden('COMMUNITY_NOT_AUTHOR', 'Only the author can delete this comment');
  const ids = (await Comment.distinct('_id', { $or: [{ _id: comment._id }, { parent: comment._id }] })) as Id[];
  await Comment.deleteMany({ _id: { $in: ids } });
  await forgetReactions(ids);
  res.json({ deleted: true, commentCount: await syncCommentCount(comment.post) });
}

/** POST /community/comments/:id/like */
export async function likeComment(req: Request, res: Response) {
  const comment = await loadVisibleComment(req.params.id);
  const result = await toggleLike(Comment, comment._id, req.user!._id);
  await recordReaction(req.user!._id, 'comment_like', comment._id, result.liked, comment.post);
  res.json(result);
}

// ---------- Reports (verified users) and sharing (anyone)

function readReport(body: unknown) {
  validate(body ?? {}, { reason: { type: 'string', required: true, enum: COMMUNITY_REPORT_REASONS }, note: { type: 'string', max: 300 } });
  const b = body as { reason: string; note?: string };
  return { reason: b.reason, note: b.note?.trim() || undefined };
}

/**
 * Adds the user's report once (not on their own content) and hides the item automatically when it reaches
 * COMMUNITY_HIDE_THRESHOLD distinct reports. Returns whether this report hid it.
 */
async function addReport(model: typeof Post | typeof Comment, id: Id, authorId: Id, req: Request): Promise<boolean> {
  const M = model as typeof Post;
  const userId = req.user!._id;
  const report = readReport(req.body);
  if (String(authorId) === String(userId)) throw forbidden('COMMUNITY_REPORT_OWN', 'You cannot report your own content');
  const added = await M.updateOne({ _id: id, 'reports.user': { $ne: userId } }, { $push: { reports: { user: userId, ...report } }, $inc: { reportCount: 1 } });
  if (!added.modifiedCount) throw conflict('COMMUNITY_ALREADY_REPORTED', 'You already reported this');
  const hidden = await M.updateOne(
    { _id: id, status: 'visible', reportCount: { $gte: COMMUNITY_HIDE_THRESHOLD } },
    { $set: { status: 'hidden', moderation: { reason: 'reports', auto: true, at: new Date() } } },
  );
  return hidden.modifiedCount > 0;
}

/** POST /community/posts/:id/report { reason, note? } */
export async function reportPost(req: Request, res: Response) {
  const post = await loadVisiblePost(req.params.id);
  res.json({ reported: true, hidden: await addReport(Post, post._id, post.author, req) });
}

/** POST /community/comments/:id/report { reason, note? }: hiding a comment updates the post's comment count. */
export async function reportComment(req: Request, res: Response) {
  const comment = await loadVisibleComment(req.params.id);
  const hidden = await addReport(Comment, comment._id, comment.author, req);
  res.json({ reported: true, hidden, commentCount: await syncCommentCount(comment.post) });
}

/** Light rate limit per IP, and the same visitor + post + network is counted once per SHARE_DEDUPE_MS. */
function counts(req: Request, kind: 'share' | 'visit', postId: Id, network: string): boolean {
  const ip = req.ip ?? 'unknown';
  if (!allow(`burst:${ip}`, SHARE_BURST_PER_MINUTE, 60_000)) throw new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again in a minute');
  return allow(`${kind}:${ip}:${postId}:${network}`, 1, SHARE_DEDUPE_MS);
}

/** POST /community/posts/:id/share { network }: counts a share (no account needed). */
export async function sharePost(req: Request, res: Response) {
  validate(req.body ?? {}, { network: { type: 'string', required: true, enum: SHARE_NETWORKS } });
  const post = await loadVisiblePost(req.params.id);
  const counted = counts(req, 'share', post._id, req.body.network);
  const updated = counted ? await Post.findByIdAndUpdate(post._id, { $inc: { [`shares.${req.body.network}`]: 1, shareCount: 1 } }, { new: true }) : post;
  res.json({ counted, shareCount: updated?.shareCount ?? 0 });
}

/** POST /community/posts/:id/visit { source }: someone arrived through a shared link (utm_source). */
export async function visitPost(req: Request, res: Response) {
  validate(req.body ?? {}, { source: { type: 'string', required: true, enum: SHARE_NETWORKS } });
  const post = await loadVisiblePost(req.params.id);
  const counted = counts(req, 'visit', post._id, req.body.source);
  const updated = counted ? await Post.findByIdAndUpdate(post._id, { $inc: { [`visits.${req.body.source}`]: 1, visitCount: 1 } }, { new: true }) : post;
  res.json({ counted, visitCount: updated?.visitCount ?? 0 });
}

// ---------- Admin moderation

const ADMIN_FILTERS = ['reported', 'hidden', 'removed', 'all'] as const;
const CONTENT_TYPES = ['post', 'comment'] as const;
type Named = { _id: Id; name: string; email?: string } | null;

function reportsView(reports: { user: unknown; reason: string; note?: string | null; createdAt?: Date | null }[]) {
  return reports.map((r) => ({ user: (r.user as Named)?.name ?? null, reason: r.reason, note: r.note ?? null, createdAt: r.createdAt ?? null }));
}

function moderationView(m: { reason?: string | null; note?: string | null; auto?: boolean | null; by?: unknown; at?: Date | null } | null | undefined) {
  return m?.at ? { reason: m.reason ?? null, note: m.note ?? null, auto: !!m.auto, by: (m.by as Named)?.name ?? null, at: m.at } : null;
}

const adminAuthor = (a: Named) => (a ? { id: String(a._id), name: a.name, email: a.email ?? null } : null);

/** GET /admin/community?type=post|comment&filter=reported|hidden|removed|all&page= */
export async function adminList(req: Request, res: Response) {
  const { page, limit, skip } = paging(req, 50);
  const kind = ADMIN_FILTERS.find((f) => f === req.query.filter) ?? 'reported';
  const type = CONTENT_TYPES.find((t) => t === req.query.type) ?? 'post';
  const filter: Record<string, unknown> = {};
  if (kind === 'reported') filter.reportCount = { $gt: 0 };
  if (kind === 'hidden' || kind === 'removed') filter.status = kind;
  const sort: Record<string, 1 | -1> = kind === 'reported' ? { reportCount: -1, createdAt: -1 } : { createdAt: -1 };
  const people = [
    { path: 'author', select: 'name email' },
    { path: 'reports.user', select: 'name' },
    { path: 'moderation.by', select: 'name' },
  ];
  let items;
  let total;
  if (type === 'post') {
    const [rows, n] = await Promise.all([
      Post.find(filter).sort(sort).skip(skip).limit(limit).populate([...people, { path: 'route', select: 'from to' }]).lean(),
      Post.countDocuments(filter),
    ]);
    total = n;
    items = rows.map((p) => {
      const route = p.route as unknown as { _id: Id; from: string; to: string } | null;
      return {
        type: 'post' as const,
        id: String(p._id),
        status: p.status,
        createdAt: p.createdAt,
        title: p.title,
        text: excerpt(p.body, 400),
        board: p.board,
        post: { id: String(p._id), title: p.title },
        route: route ? { id: String(route._id), from: route.from, to: route.to } : null,
        city: p.city ?? null,
        photos: p.photos.length,
        author: adminAuthor(p.author as unknown as Named),
        likeCount: p.likeCount,
        commentCount: p.commentCount,
        shareCount: p.shareCount ?? 0,
        reportCount: p.reportCount,
        reports: reportsView(p.reports),
        moderation: moderationView(p.moderation),
      };
    });
  } else {
    const [rows, n] = await Promise.all([
      Comment.find(filter).sort(sort).skip(skip).limit(limit).populate([...people, { path: 'post', select: 'title board status' }]).lean(),
      Comment.countDocuments(filter),
    ]);
    total = n;
    items = rows.map((c) => {
      const post = c.post as unknown as { _id: Id; title: string; board: string; status: string } | null;
      return {
        type: 'comment' as const,
        id: String(c._id),
        status: c.status,
        createdAt: c.createdAt,
        title: null,
        text: c.body,
        board: post?.board ?? null,
        post: post ? { id: String(post._id), title: post.title, status: post.status } : null,
        reply: !!c.parent,
        author: adminAuthor(c.author as unknown as Named),
        likeCount: c.likeCount,
        reportCount: c.reportCount,
        reports: reportsView(c.reports),
        moderation: moderationView(c.moderation),
      };
    });
  }
  res.json({ items, total, page, limit, filter: kind, type });
}

async function moderate(req: Request, set: Record<string, unknown>, unset: Record<string, 1> = {}) {
  const type = CONTENT_TYPES.find((t) => t === req.params.type);
  const missing = () => (type === 'comment' ? notFound('COMMUNITY_COMMENT_NOT_FOUND', 'Comment not found') : notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found'));
  if (!type || !isObjectId(req.params.id)) throw missing();
  const update = { $set: set, ...(Object.keys(unset).length && { $unset: unset }) };
  const doc =
    type === 'post'
      ? await Post.findByIdAndUpdate(req.params.id, update, { new: true })
      : await Comment.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!doc) throw missing();
  const postId = type === 'post' ? doc._id : (doc as unknown as { post: Id }).post;
  const commentCount = await syncCommentCount(postId);
  return { item: { type, id: String(doc._id), status: doc.status, reportCount: doc.reportCount }, commentCount };
}

/** POST /admin/community/:type/:id/hide { note? } */
export async function adminHide(req: Request, res: Response) {
  validate(req.body ?? {}, { note: { type: 'string', max: 300 } });
  res.json(await moderate(req, { status: 'hidden', moderation: { reason: 'moderator', note: req.body?.note?.trim() || undefined, by: req.user!._id, auto: false, at: new Date() } }));
}

/** POST /admin/community/:type/:id/remove { reason, note? }: reason required. */
export async function adminRemove(req: Request, res: Response) {
  validate(req.body ?? {}, { reason: { type: 'string', required: true, enum: COMMUNITY_REMOVE_REASONS }, note: { type: 'string', max: 300 } });
  res.json(await moderate(req, { status: 'removed', moderation: { reason: req.body.reason, note: req.body.note?.trim() || undefined, by: req.user!._id, auto: false, at: new Date() } }));
}

/** POST /admin/community/:type/:id/restore { clearReports? = true }: restoring clears the reports unless told otherwise. */
export async function adminRestore(req: Request, res: Response) {
  validate(req.body ?? {}, { clearReports: { type: 'boolean' } });
  const clear = req.body?.clearReports !== false;
  res.json(await moderate(req, { status: 'visible', ...(clear && { reports: [], reportCount: 0 }) }, { moderation: 1 }));
}
