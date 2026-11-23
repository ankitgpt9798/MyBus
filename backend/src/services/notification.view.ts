import { Types } from 'mongoose';
import { NotificationAttrs } from '../models/Notification';

export type NotificationLean = NotificationAttrs & { _id: Types.ObjectId; createdAt?: Date };

/** Notification as returned to its owner (bell, history, live stream). */
export function publicNotification(n: NotificationLean) {
  return {
    id: String(n._id),
    type: n.type,
    templateKey: n.templateKey,
    params: n.params ?? {},
    title: n.title,
    body: n.body,
    language: n.language,
    pnr: n.pnr ?? null,
    bookingId: n.booking ? String(n.booking) : null,
    read: n.read,
    createdAt: n.createdAt,
    deliveries: n.deliveries.map((d) => ({ channel: d.channel, status: d.status, skipReason: d.skipReason ?? null })),
  };
}
