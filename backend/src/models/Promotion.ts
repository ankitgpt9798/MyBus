import { HydratedDocument, InferSchemaType, Schema, model } from 'mongoose';

export const PROMOTION_TARGETS = ['all', 'route', 'city'] as const;

/** An offer campaign sent by an admin. Each recipient gets a 'promotion' notification (see the delivery log). */
const promotionSchema = new Schema(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    // Optional per-language versions: { hi: { title, body }, ... }; missing languages fall back to English.
    translations: { type: Schema.Types.Mixed, default: {} },
    target: {
      kind: { type: String, enum: PROMOTION_TARGETS, required: true },
      from: String,
      to: String,
      city: String,
    },
    status: { type: String, enum: ['sending', 'sent'], default: 'sending' },
    recipients: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedAt: Date,
  },
  { timestamps: true },
);
promotionSchema.index({ createdAt: -1 });

export type PromotionAttrs = InferSchemaType<typeof promotionSchema>;
export type PromotionDoc = HydratedDocument<PromotionAttrs>;
export const Promotion = model('Promotion', promotionSchema);
