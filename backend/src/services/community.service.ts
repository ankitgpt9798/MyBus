import { Types } from 'mongoose';
import { Comment } from '../models/Comment';
import { Post } from '../models/Post';
import { Reaction, ReactionKind } from '../models/Reaction';
import { POPULAR_MIN_ENGAGEMENT, engagement } from './community.rules';
import { displayName } from './review.service';
import { StoredPhoto, photoView } from './photo-storage.service';

type Id = Types.ObjectId;
export type AuthorRef = { _id: Id; name: string } | null;
type RouteRef = { _id: Id; from: string; to: string } | null;

const EXCERPT = 280;

/** Public author: id (for the profile link) and display name only, never the email. */
export const authorView = (a: AuthorRef) => (a ? { id: String(a._id), name: displayName(a.name) } : { id: null, name: displayName('') });

export const excerpt = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

export type PostLean = {
  _id: Id;
  author: AuthorRef;
  board: string;
  title: string;
  body: string;
  photos: StoredPhoto[];
  route?: RouteRef;
  city?: string | null;
  language?: string | null;
  likedBy: Id[];
  likeCount: number;
  commentCount: number;
  shareCount?: number | null;
  status: 'visible' | 'hidden' | 'removed';
  moderation?: { reason?: string | null; auto?: boolean | null; at?: Date | null } | null;
  reports?: { user: Id }[];
  createdAt: Date;
  editedAt?: Date | null;
  score?: number;
};

/** A post as shown in lists (excerpt) or on its page (full); moderation details only matter to its author. */
export function viewPost(p: PostLean, viewer: string | null, full: boolean) {
  const truncated = !full && p.body.length > EXCERPT;
  return {
    id: String(p._id),
    board: p.board,
    title: p.title,
    body: truncated ? excerpt(p.body, EXCERPT) : p.body,
    truncated,
    photos: p.photos.map(photoView),
    route: p.route ? { id: String(p.route._id), from: p.route.from, to: p.route.to } : null,
    city: p.city ?? null,
    language: p.language ?? 'en',
    author: authorView(p.author),
    likeCount: p.likeCount,
    likedByMe: viewer ? p.likedBy.some((u) => String(u) === viewer) : false,
    commentCount: p.commentCount,
    shareCount: p.shareCount ?? 0,
    popular: engagement(p) >= POPULAR_MIN_ENGAGEMENT,
    ...(p.score !== undefined && { score: Math.round(p.score * 1000) / 1000 }),
    reportedByMe: viewer ? (p.reports ?? []).some((r) => String(r.user) === viewer) : false,
    mine: !!viewer && String(p.author?._id) === viewer,
    status: p.status,
    moderation: p.status !== 'visible' && p.moderation?.at ? { reason: p.moderation.reason ?? null, auto: !!p.moderation.auto, at: p.moderation.at } : null,
    createdAt: p.createdAt,
    editedAt: p.editedAt ?? null,
  };
}

/** Ids of posts and comments that are hidden or removed (small sets in practice). */
export async function hiddenIds(): Promise<{ posts: Id[]; comments: Id[] }> {
  const [posts, comments] = await Promise.all([Post.distinct('_id', { status: { $ne: 'visible' } }), Comment.distinct('_id', { status: { $ne: 'visible' } })]);
  return { posts: posts as Id[], comments: comments as Id[] };
}

/** Comments the public can see: visible, on a visible post, and (for replies) under a visible comment. */
export const visibleCommentFilter = (h: { posts: Id[]; comments: Id[] }) => ({ status: 'visible' as const, post: { $nin: h.posts }, parent: { $nin: h.comments } });

/** Visible comment count of a post (replies under a hidden comment are not shown, so they don't count). */
export async function syncCommentCount(postId: Id): Promise<number> {
  const hiddenParents = (await Comment.distinct('_id', { post: postId, status: { $ne: 'visible' } })) as Id[];
  const commentCount = await Comment.countDocuments({ post: postId, status: 'visible', parent: { $nin: hiddenParents } });
  await Post.updateOne({ _id: postId }, { $set: { commentCount } });
  return commentCount;
}

/** Records (or forgets) when a user liked something, for their activity timeline. */
export async function recordReaction(user: Id, kind: ReactionKind, target: Id, on: boolean, post?: Id): Promise<void> {
  if (!on) {
    await Reaction.deleteOne({ user, kind, target });
    return;
  }
  try {
    await Reaction.updateOne({ user, kind, target }, { $setOnInsert: { post } }, { upsert: true });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err; // a parallel request already recorded it
  }
}

export const forgetReactions = (targets: Id[]) => Reaction.deleteMany({ target: { $in: targets } });
