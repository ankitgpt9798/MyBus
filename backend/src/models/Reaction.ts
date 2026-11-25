import { HydratedDocument, InferSchemaType, Schema, model } from 'mongoose';

export const REACTION_KINDS = ['post_like', 'comment_like', 'review_helpful'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/**
 * When a user liked a post or comment, or voted a review helpful. The counters live on the content itself;
 * this log only adds the time, for the activity timeline on public profiles.
 */
const reactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: REACTION_KINDS, required: true },
    target: { type: Schema.Types.ObjectId, required: true }, // the post, comment or review
    post: { type: Schema.Types.ObjectId, ref: 'Post' }, // for comment likes: the post the comment is on
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

reactionSchema.index({ kind: 1, target: 1, user: 1 }, { unique: true });
reactionSchema.index({ user: 1, createdAt: -1 });

export type ReactionAttrs = InferSchemaType<typeof reactionSchema>;
export type ReactionDoc = HydratedDocument<ReactionAttrs>;
export const Reaction = model('Reaction', reactionSchema);
