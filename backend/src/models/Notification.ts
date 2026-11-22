import { HydratedDocument, InferSchemaType, Schema, model } from 'mongoose';
import { SUPPORTED_LANGUAGES } from '../i18n';

export const NOTIFICATION_TYPES = ['booking_confirmed', 'booking_cancelled', 'schedule_changed', 'journey_reminder', 'promotion'] as const;
export const CHANNELS = ['in_app', 'email', 'push'] as const;
export const DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type Channel = (typeof CHANNELS)[number];

// One entry per channel. Retries (attempts / nextAttemptAt) are driven by the notification worker.
const deliverySchema = new Schema(
  {
    channel: { type: String, enum: CHANNELS, required: true },
    status: { type: String, enum: DELIVERY_STATUSES, default: 'pending' },
    attempts: { type: Number, default: 0 },
    lastError: String,
    skipReason: { type: String, enum: ['preference_off', 'promotions_opt_out', 'not_available'] },
    transport: String, // e.g. 'smtp' or 'console' for email
    sentAt: Date,
    nextAttemptAt: Date,
  },
  { _id: false },
);

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    // templateKey + params let any UI re-render the message in the reader's current language.
    templateKey: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    // Rendered copy, in the language it was sent in.
    language: { type: String, enum: SUPPORTED_LANGUAGES, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    emailTo: String,
    booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
    pnr: String,
    read: { type: Boolean, default: false },
    readAt: Date,
    deliveries: { type: [deliverySchema], default: [] },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, read: 1 });
notificationSchema.index({ 'deliveries.status': 1, 'deliveries.nextAttemptAt': 1 });
notificationSchema.index({ type: 1, createdAt: -1 });

export type NotificationAttrs = InferSchemaType<typeof notificationSchema>;
export type NotificationDoc = HydratedDocument<NotificationAttrs>;
export const Notification = model('Notification', notificationSchema);
