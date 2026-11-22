import { InferSchemaType, Schema, model } from 'mongoose';

/** A browser's Web Push subscription. One user can have several (devices/browsers). */
const pushSubscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: '' },
    lastUsedAt: Date,
  },
  { timestamps: true },
);

export type PushSubscriptionAttrs = InferSchemaType<typeof pushSubscriptionSchema>;
export const PushSubscription = model('PushSubscription', pushSubscriptionSchema);
