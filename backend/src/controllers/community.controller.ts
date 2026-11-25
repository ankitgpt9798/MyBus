import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { isLang } from '../i18n';
import { Comment } from '../models/Comment';
import { BOARDS, Post, PostDoc } from '../models/Post';
import { Route } from '../models/Route';
import { guidelineViolation } from '../services/review.rules';
import { displayName } from '../services/review.service';
import { MAX_PHOTOS, checkPhotos, deletePhotos, photoUrl, savePhotos } from '../services/upload.service';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/AppError';
import { isObjectId, validate } from '../utils/validate';

export const POST_TITLE = { min: 5, max: 120 };
export const POST_BODY = { min: 20, max: 5000 };
export const COMMENT_BODY = { min: 2, max: 1000 };
const ALT_MAX = 150;
const EXCERPT = 280;
const SORTS = { latest: { createdAt: -1 }, top: { likeCount: -1, createdAt: -1 }, discussed: { commentCount: -1, createdAt: -1 } } as const;

type Id = Types.ObjectId;
type Author = { _id: Id; name: string } | null;
type RouteRef = { _id: Id; from: string; to: string } | null;

const viewerOf = (req: Request) => (req.user ? String(req.user._id) : null);
const paging = (req: Request) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10));
  return { page, limit, skip: (page - 1) * limit };
};
const author = (a: Author) => (a ? { id: String(a._id), name: displayName(a.name) } : { id: null, name: displayName('') });

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

type PostLean = {
  _id: Id;
  author: Author;
  board: string;
  title: string;
  body: string;
  photos: { file: string; alt?: string | null }[];
  route?: RouteRef;
  city?: string | null;
  language?: string | null;
  likedBy: Id[];
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  editedAt?: Date | null;
};

function viewPost(p: PostLean, viewer: string | null, full: boolean) {
  const truncated = !full && p.body.length > EXCERPT;
  return {
    id: String(p._id),
    board: p.board,
    title: p.title,
    body: truncated ? `${p.body.slice(0, EXCERPT).trimEnd()}…` : p.body,
    truncated,
    photos: p.photos.map((ph) => ({ url: photoUrl(ph.file), alt: ph.alt ?? '' })),
    route: p.route ? { id: String(p.route._id), from: p.route.from, to: p.route.to } : null,
    city: p.city ?? null,
    language: p.language ?? 'en',
    author: author(p.author),
    likeCount: p.likeCount,
    likedByMe: viewer ? p.likedBy.some((u) => String(u) === viewer) : false,
    commentCount: p.commentCount,
    mine: !!viewer && String(p.author?._id) === viewer,
    createdAt: p.createdAt,
    editedAt: p.editedAt ?? null,
  };
}

async function loadVisiblePost(id: unknown) {
  if (!isObjectId(id)) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  const post = await Post.findById(id);
  if (!post || post.status !== 'visible') throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  return post;
}

async function postView(id: Id, viewer: string | null) {
  const p = await Post.findById(id).populate('author', 'name').populate('route', 'from to').lean();
  return viewPost(p as unknown as PostLean, viewer, true);
}

/** Visible comment count, recomputed so it stays exact after creates and deletes. */
async function syncCommentCount(postId: Id) {
  const commentCount = await Comment.countDocuments({ post: postId, status: 'visible' });
  await Post.updateOne({ _id: postId }, { $set: { commentCount } });
  return commentCount;
}

// ---------- Boards and feed (public)

/** GET /community/boards: the fixed boards with their number of posts and latest activity. */
export async function boards(_req: Request, res: Response) {
  const rows: { _id: string; posts: number; latest: Date }[] = await Post.aggregate([
    { $match: { status: 'visible' } },
    { $group: { _id: '$board', posts: { $sum: 1 }, latest: { $max: '$createdAt' } } },
  ]);
  res.json({ boards: BOARDS.map((id) => ({ id, posts: rows.find((r) => r._id === id)?.posts ?? 0, latestAt: rows.find((r) => r._id === id)?.latest ?? null })) });
}

/** GET /community/posts?board&routeId&city&sort=latest|top|discussed&page */
export async function listPosts(req: Request, res: Response) {
  const { page, limit, skip } = paging(req);
  const filter: Record<string, unknown> = { status: 'visible' };
  const board = BOARDS.find((b) => b === req.query.board);
  if (board) filter.board = board;
  if (isObjectId(req.query.routeId)) filter.route = new Types.ObjectId(String(req.query.routeId));
  if (typeof req.query.city === 'string' && req.query.city) filter.city = req.query.city;
  const sortKey = (Object.keys(SORTS) as (keyof typeof SORTS)[]).find((s) => s === req.query.sort) ?? 'latest';
  const [items, total] = await Promise.all([
    Post.find(filter).sort(SORTS[sortKey]).skip(skip).limit(limit).populate('author', 'name').populate('route', 'from to').lean(),
    Post.countDocuments(filter),
  ]);
  const viewer = viewerOf(req);
  res.json({ posts: items.map((p) => viewPost(p as unknown as PostLean, viewer, false)), total, page, limit, sort: sortKey });
}

/** GET /community/posts/:id: the post with its comments (replies nested one level). */
export async function getPost(req: Request, res: Response) {
  const post = await loadVisiblePost(req.params.id);
  const viewer = viewerOf(req);
  const [view, comments] = await Promise.all([
    postView(post._id, viewer),
    Comment.find({ post: post._id, status: 'visible' }).sort({ createdAt: 1 }).limit(1000).populate('author', 'name').lean(),
  ]);
  const toView = (c: (typeof comments)[number]) => ({
    id: String(c._id),
    parentId: c.parent ? String(c.parent) : null,
    body: c.body,
    author: author(c.author as unknown as Author),
    likeCount: c.likeCount,
    likedByMe: viewer ? c.likedBy.some((u) => String(u) === viewer) : false,
    mine: !!viewer && String((c.author as unknown as Author)?._id) === viewer,
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
  const saved = await savePhotos(files, types);
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
    await deletePhotos(saved.map((s) => s.file));
    throw err;
  }
  res.status(201).json({ post: await postView(post._id, viewerOf(req)) });
}

/**
 * PATCH /community/posts/:id (multipart): any post field, plus
 *  keep: JSON [{ file, alt }] of existing photos to keep (all kept when omitted) and new photos[].
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
  let kept = post.photos.map((p) => ({ file: p.file, type: p.type, size: p.size, alt: p.alt ?? '' }));
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
      .filter((p) => wanted.some((w) => w.file === p.file))
      .map((p) => ({ ...p, alt: String(wanted.find((w) => w.file === p.file)?.alt ?? p.alt).trim().slice(0, ALT_MAX) }));
  }
  if (kept.length + files.length > MAX_PHOTOS) {
    throw new AppError(400, 'COMMUNITY_TOO_MANY_PHOTOS', 'At most 4 photos per post', [{ field: 'photos', rule: 'maxItems', params: { max: MAX_PHOTOS } }]);
  }
  const types = checkPhotos(files);
  const alts = readAlts(req.body?.alts, files.length);
  const dropped = post.photos.map((p) => p.file).filter((f) => !kept.some((k) => k.file === f));
  const saved = await savePhotos(files, types);
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
    await deletePhotos(saved.map((s) => s.file));
    throw err;
  }
  await deletePhotos(dropped);
  res.json({ post: await postView(post._id, viewerOf(req)) });
}

/** DELETE /community/posts/:id: the author removes their post, its comments and its photo files. */
export async function deletePost(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  const post = await Post.findById(req.params.id);
  if (!post) throw notFound('COMMUNITY_POST_NOT_FOUND', 'Post not found');
  if (String(post.author) !== String(req.user!._id)) throw forbidden('COMMUNITY_NOT_AUTHOR', 'Only the author can delete this post');
  await Comment.deleteMany({ post: post._id });
  await Post.deleteOne({ _id: post._id });
  await deletePhotos(post.photos.map((p) => p.file));
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
  res.json(await toggleLike(Post, post._id, req.user!._id));
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
      author: author({ _id: req.user!._id, name: req.user!.name }),
      likeCount: 0,
      likedByMe: false,
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
  await Comment.deleteMany({ $or: [{ _id: comment._id }, { parent: comment._id }] });
  res.json({ deleted: true, commentCount: await syncCommentCount(comment.post) });
}

/** POST /community/comments/:id/like */
export async function likeComment(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('COMMUNITY_COMMENT_NOT_FOUND', 'Comment not found');
  const comment = await Comment.findById(req.params.id).lean();
  if (!comment || comment.status !== 'visible') throw notFound('COMMUNITY_COMMENT_NOT_FOUND', 'Comment not found');
  res.json(await toggleLike(Comment, comment._id, req.user!._id));
}
