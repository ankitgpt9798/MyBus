import { HydratedDocument, InferSchemaType, Schema, model } from 'mongoose';
import { CONTENT_STATUSES, moderationSchema, reportSchema } from './Post';

/** A comment on a post, or a reply to a top-level comment (one level deep). */
const commentSchema = new Schema(
  {
    post: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Comment' }, // set for replies only
    body: { type: String, required: true },
    likedBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    likeCount: { type: Number, default: 0 },
    status: { type: String, enum: CONTENT_STATUSES, default: 'visible' },
    moderation: moderationSchema,
    reports: { type: [reportSchema], default: [] },
    reportCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

commentSchema.index({ post: 1, status: 1, createdAt: 1 });
commentSchema.index({ parent: 1 });
commentSchema.index({ author: 1, createdAt: -1 });
commentSchema.index({ status: 1, reportCount: -1 });

export type CommentAttrs = InferSchemaType<typeof commentSchema>;
export type CommentDoc = HydratedDocument<CommentAttrs>;
export const Comment = model('Comment', commentSchema);
