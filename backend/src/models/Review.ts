import { HydratedDocument, InferSchemaType, Schema, model } from 'mongoose';
import { REMOVE_REASONS, REPORT_REASONS } from '../services/review.rules';

export const REVIEW_STATUSES = ['visible', 'hidden', 'removed'] as const;

const reportSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    note: { type: String, maxlength: 300 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * A traveller's rating + review of a route for one completed journey (booking).
 * Only `visible` reviews are shown publicly and count in the route's average rating.
 */
const reviewSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    route: { type: Schema.Types.ObjectId, ref: 'Route', required: true },
    trip: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, required: true },
    status: { type: String, enum: REVIEW_STATUSES, default: 'visible' },
    // Why and by whom it was hidden (reports or an admin) or removed (guideline violation, admin only).
    moderation: {
      reason: { type: String },
      note: { type: String },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      auto: { type: Boolean },
      at: { type: Date },
    },
    reports: { type: [reportSchema], default: [] },
    reportCount: { type: Number, default: 0 },
    helpfulBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    helpfulCount: { type: Number, default: 0 },
    editedAt: Date,
    editableUntil: { type: Date, required: true },
  },
  { timestamps: true },
);

// Once per journey.
reviewSchema.index({ booking: 1 }, { unique: true });
reviewSchema.index({ route: 1, status: 1, createdAt: -1 });
reviewSchema.index({ route: 1, status: 1, helpfulCount: -1 });
reviewSchema.index({ user: 1, status: 1 });
reviewSchema.index({ status: 1, reportCount: -1 });

export { REMOVE_REASONS, REPORT_REASONS };
export type ReviewAttrs = InferSchemaType<typeof reviewSchema>;
export type ReviewDoc = HydratedDocument<ReviewAttrs>;
export const Review = model('Review', reviewSchema);
