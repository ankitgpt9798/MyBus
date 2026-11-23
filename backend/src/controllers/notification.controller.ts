import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { CHANNELS, DELIVERY_STATUSES, NOTIFICATION_TYPES, Notification } from '../models/Notification';
import { PushSubscription } from '../models/PushSubscription';
import { User } from '../models/User';
import { countUnread, dispatch } from '../services/notification.service';
import { NotificationLean, publicNotification } from '../services/notification.view';
import { vapidKeys } from '../services/push.service';
import { HEARTBEAT_MS, addStream, publish } from '../services/realtime.service';
import { badRequest, notFound, unauthorized } from '../utils/AppError';
import { isObjectId, validate } from '../utils/validate';

const paging = (req: Request, max = 50) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(max, Math.max(1, Number(req.query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * GET /notifications: the signed-in user's notifications (bell + history), newest first, plus the unread count.
 * Optional filters: ?type=<notification type> and ?unread=true.
 */
export async function listMine(req: Request, res: Response) {
  const { page, limit, skip } = paging(req);
  const user = req.user!._id;
  const filter: Record<string, unknown> = { user, inbox: { $ne: false } };
  const type = NOTIFICATION_TYPES.find((t) => t === req.query.type);
  if (type) filter.type = type;
  if (req.query.unread === 'true') filter.read = false;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean<NotificationLean[]>(),
    Notification.countDocuments(filter),
    countUnread(user),
  ]);
  res.json({ notifications: items.map(publicNotification), total, unread, page, limit });
}

export async function unreadCount(req: Request, res: Response) {
  res.json({ unread: await countUnread(req.user!._id) });
}

export async function markRead(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  const result = await Notification.updateOne({ _id: req.params.id, user: req.user!._id }, { $set: { read: true, readAt: new Date() } });
  if (!result.matchedCount) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  const unread = await countUnread(req.user!._id);
  publish(String(req.user!._id), 'unread', { unread }); // keep the user's other tabs in sync
  res.json({ unread });
}

export async function markAllRead(req: Request, res: Response) {
  await Notification.updateMany({ user: req.user!._id, read: false }, { $set: { read: true, readAt: new Date() } });
  publish(String(req.user!._id), 'unread', { unread: 0 });
  res.json({ unread: 0 });
}

// ---------- Web push subscriptions

export function pushPublicKey(_req: Request, res: Response) {
  res.json({ publicKey: vapidKeys().publicKey });
}

export async function pushSubscribe(req: Request, res: Response) {
  validate(req.body, { endpoint: { type: 'string', required: true, max: 1000, pattern: /^https:\/\// }, keys: { type: 'object', required: true } });
  validate(req.body.keys, { p256dh: { type: 'string', required: true, max: 200 }, auth: { type: 'string', required: true, max: 100 } });
  // An endpoint belongs to one browser; re-subscribing (e.g. another account on the same browser) moves it.
  await PushSubscription.updateOne(
    { endpoint: req.body.endpoint },
    {
      $set: {
        user: req.user!._id,
        keys: { p256dh: req.body.keys.p256dh, auth: req.body.keys.auth },
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      },
    },
    { upsert: true },
  );
  // Turning push on in this browser (optIn) also switches the account's push preference on.
  if (req.body.optIn === true) await User.updateOne({ _id: req.user!._id }, { $set: { 'notificationPreferences.push': true } });
  res.status(201).json({ subscribed: true, devices: await PushSubscription.countDocuments({ user: req.user!._id }) });
}

export async function pushUnsubscribe(req: Request, res: Response) {
  validate(req.body, { endpoint: { type: 'string', required: true, max: 1000 } });
  await PushSubscription.deleteOne({ endpoint: req.body.endpoint, user: req.user!._id });
  // Turning push off in the settings (optOut) stops it on every device, not just this browser.
  if (req.body.optOut === true) await User.updateOne({ _id: req.user!._id }, { $set: { 'notificationPreferences.push': false } });
  res.json({ subscribed: false, devices: await PushSubscription.countDocuments({ user: req.user!._id }) });
}

// ---------- Real-time stream (Server-Sent Events)

const STREAM_TOKEN_TTL_S = 60;

/**
 * POST /notifications/stream-token: EventSource cannot send an Authorization header, so the app exchanges its
 * session for a short-lived, stream-only token and puts that (not the long-lived JWT) in the stream URL.
 */
export function streamToken(req: Request, res: Response) {
  const token = jwt.sign({ purpose: 'notification-stream' }, env.jwtSecret, { subject: String(req.user!._id), expiresIn: STREAM_TOKEN_TTL_S });
  res.json({ token, expiresIn: STREAM_TOKEN_TTL_S });
}

/** GET /notifications/stream?token=…: live 'notification' and 'unread' events for the signed-in user. */
export async function stream(req: Request, res: Response) {
  let userId: string;
  try {
    const payload = jwt.verify(String(req.query.token ?? ''), env.jwtSecret) as jwt.JwtPayload;
    if (payload.purpose !== 'notification-stream' || !payload.sub) throw new Error('wrong token');
    userId = payload.sub;
  } catch {
    throw unauthorized('STREAM_TOKEN_INVALID', 'Stream token is invalid or expired');
  }
  if (!(await User.exists({ _id: userId }))) throw unauthorized('STREAM_TOKEN_INVALID', 'Account no longer exists');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  res.write(`event: ready\ndata: ${JSON.stringify({ unread: await countUnread(userId), heartbeatMs: HEARTBEAT_MS })}\n\n`);
  addStream(userId, res);
}

// ---------- Admin delivery log

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
  res.json({ notifications: items.map(adminView), total, page, limit });
}

type PopulatedUser = { _id: Types.ObjectId; name: string; email: string } | null;

function adminView(n: Omit<NotificationLean, 'user'> & { user: PopulatedUser }) {
  return {
    ...publicNotification({ ...n, user: n.user?._id } as NotificationLean),
    user: n.user ? { id: String(n.user._id), name: n.user.name, email: n.user.email } : null,
    emailTo: n.emailTo ?? null,
    deliveries: n.deliveries.map((d) => ({
      channel: d.channel,
      status: d.status,
      attempts: d.attempts,
      lastError: d.lastError ?? null,
      skipReason: d.skipReason ?? null,
      gaveUp: d.gaveUp ?? false,
      transport: d.transport ?? null,
      sentAt: d.sentAt ?? null,
      nextAttemptAt: d.nextAttemptAt ?? null,
    })),
  };
}

/** POST /admin/notifications/:id/retry: retry its failed deliveries now (also ones that gave up). */
export async function adminRetry(req: Request, res: Response) {
  if (!isObjectId(req.params.id)) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  const n = await Notification.findById(req.params.id).lean();
  if (!n) throw notFound('NOTIFICATION_NOT_FOUND', 'Notification not found');
  if (!n.deliveries.some((d) => d.status === 'failed')) throw badRequest('NOTIFICATION_NOTHING_TO_RETRY', 'No failed deliveries to retry');
  await dispatch(n._id, { force: true });
  const fresh = await Notification.findById(n._id).populate<{ user: { _id: Types.ObjectId; name: string; email: string } }>('user', 'name email').lean();
  res.json({ notification: adminView(fresh!) });
}
