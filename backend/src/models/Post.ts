import { HydratedDocument, InferSchemaType, Schema, model } from 'mongoose';
import { SUPPORTED_LANGUAGES } from '../i18n';
import { SHARE_NETWORKS } from '../services/community.rules';

/** Fixed discussion boards (names and descriptions are translated in the web app). */
export const BOARDS = ['stories', 'tips', 'routes', 'destinations', 'advice'] as const;
export const CONTENT_STATUSES = ['visible', 'hidden', 'removed'] as const;

const photoSchema = new Schema(
  {
    file: { type: String, required: true }, // random name under uploads/community
    type: { type: String, enum: ['jpg', 'png', 'webp'], required: true },
    size: { type: Number, required: true },
    alt: { type: String, default: '', maxlength: 150 },
  },
  { _id: false },
);

export const reportSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, required: true },
    note: { type: String, maxlength: 300 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

export const moderationSchema = new Schema(
  {
    reason: String,
    note: String,
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    auto: Boolean,
    at: Date,
  },
  { _id: false },
);

/** Counter per share network (shares out, and visits back from that network). */
const perNetwork = () => Object.fromEntries(SHARE_NETWORKS.map((n) => [n, { type: Number, default: 0 }]));

/** A community post (journey story, tip, route / destination discussion, question) with up to 4 photos. */
const postSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    board: { type: String, enum: BOARDS, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true }, // plain text, rendered with line breaks only
    photos: { type: [photoSchema], default: [] },
    route: { type: Schema.Types.ObjectId, ref: 'Route' },
    city: String,
    language: { type: String, enum: SUPPORTED_LANGUAGES, default: 'en' },
    likedBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    // Social sharing: shares per network and visits that came back through a shared link (utm_source).
    shares: perNetwork(),
    shareCount: { type: Number, default: 0 },
    visits: perNetwork(),
    visitCount: { type: Number, default: 0 },
    // Moderation (reports, hide / remove) is handled by the community moderation tools.
    status: { type: String, enum: CONTENT_STATUSES, default: 'visible' },
    moderation: moderationSchema,
    reports: { type: [reportSchema], default: [] },
    reportCount: { type: Number, default: 0 },
    editedAt: Date,
  },
  { timestamps: true },
);

postSchema.index({ status: 1, createdAt: -1 });
postSchema.index({ status: 1, board: 1, createdAt: -1 });
postSchema.index({ status: 1, likeCount: -1, createdAt: -1 });
postSchema.index({ status: 1, commentCount: -1, createdAt: -1 });
postSchema.index({ route: 1, status: 1, createdAt: -1 });
postSchema.index({ city: 1, status: 1, createdAt: -1 });
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ status: 1, reportCount: -1 });

export type PostAttrs = InferSchemaType<typeof postSchema>;
export type PostDoc = HydratedDocument<PostAttrs>;
export const Post = model('Post', postSchema);
