import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { CHANNELS, DELIVERY_STATUSES, NOTIFICATION_TYPES, Notification, NotificationAttrs } from '../models/Notification';
import { notFound } from '../utils/AppError';
import { isObjectId } from '../utils/validate';

type NotificationLean = NotificationAttrs & { _id: Types.ObjectId; createdAt?: Date };

const paging = (req: Request, max = 50) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(max, Math.max(1, Number(req.query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

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
    deliveries: n.deliveries.map((d) => ({ channel: d.channel, status: d.status })),
  };
}

/** GET /notifications: the signed-in user's notifications, newest first, plus the unread count. */
export async function listMine(req: Request, res: Response) {
  const { page, limit, skip } = paging(req);
  const user = req.user!._id;
  const [items, total, unread] = await Promise.all([
    Notification.find({ user }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<NotificationLean[]>(),
    Notification.countDocuments({ user }),
    Notification.countDocuments({ user, read: false }),
  ]);
  res.json({ notifications: items.map(publicNotification), total, unread, page, limit });
}

export async function unreadCount(req: Request, res: Response) {
  res.json({ unread: await Notification.countDocuments({ user: req.user!._id, read: false }) });
}

export async function markRead(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  const result = await Notification.updateOne({ _id: req.params.id, user: req.user!._id }, { $set: { read: true, readAt: new Date() } });
  if (!result.matchedCount) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  res.json({ unread: await Notification.countDocuments({ user: req.user!._id, read: false }) });
}

export async function markAllRead(req: Request, res: Response) {
  await Notification.updateMany({ user: req.user!._id, read: false }, { $set: { read: true, readAt: new Date() } });
  res.json({ unread: 0 });
}

/** GET /admin/notifications: delivery log, filterable by delivery status, channel and type. */
export async function adminList(req: Request, res: Response) {
  const { page, limit, skip } = paging(req, 100);
  const filter: Record<string, unknown> = {};
  const status = DELIVERY_STATUSES.find((s) => s === req.query.status);
  const channel = CHANNELS.find((c) => c === req.query.channel);
  const type = NOTIFICATION_TYPES.find((t) => t === req.query.type);
  if (type) filter.type = type;
  if (status || channel) filter.deliveries = { $elemMatch: { ...(status && { status }), ...(channel && { channel }) } };

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate<{ user: { _id: Types.ObjectId; name: string; email: string } }>('user', 'name email')
      .lean(),
    Notification.countDocuments(filter),
  ]);
  res.json({
    notifications: items.map((n) => ({
      ...publicNotification({ ...n, user: n.user?._id } as NotificationLean),
      user: n.user ? { id: String(n.user._id), name: n.user.name, email: n.user.email } : null,
      emailTo: n.emailTo ?? null,
      deliveries: n.deliveries.map((d) => ({
        channel: d.channel,
        status: d.status,
        attempts: d.attempts,
        lastError: d.lastError ?? null,
        skipReason: d.skipReason ?? null,
        transport: d.transport ?? null,
        sentAt: d.sentAt ?? null,
        nextAttemptAt: d.nextAttemptAt ?? null,
      })),
    })),
    total,
    page,
    limit,
  });
}
