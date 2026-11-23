import { Types } from 'mongoose';
import { env } from '../config/env';
import { DEFAULT_LANGUAGE, isLang } from '../i18n';
import { Channel, Notification, NotificationDoc, NotificationType } from '../models/Notification';
import { PushSubscription } from '../models/PushSubscription';
import { User, UserDoc } from '../models/User';
import { sendMail } from './mail.service';
import { NotificationParams, renderNotification } from './notification.templates';
import { NotificationLean, publicNotification } from './notification.view';
import { sendPushToUser } from './push.service';
import { publish } from './realtime.service';

/** Wait before the next attempt after the 1st, 2nd, 3rd failure (default 1 min → 5 min → 15 min). */
export const RETRY_DELAYS_MS = env.notifications.retryDelaysMs;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Notifications created after this are dispatched by notify() itself, so startup resume leaves them alone. */
const STARTED_AT = new Date();

type SendResult = { status: 'sent'; transport: string } | { status: 'skipped'; skipReason: 'no_subscription' };
type Sender = (n: NotificationDoc, user: UserDoc) => Promise<SendResult>;

const SENDERS: Record<Channel, Sender> = {
  // The stored notification *is* the in-app message (bell, history, live stream) — it never needs a retry.
  in_app: async () => ({ status: 'sent', transport: 'inbox' }),
  email: async (n, user) => {
    const { email } = renderNotification(n.type, n.language, (n.params ?? {}) as NotificationParams, user.name);
    const result = await sendMail({ to: n.emailTo || user.email, ...email });
    return { status: 'sent', transport: result.transport };
  },
  push: async (n) => {
    const params = (n.params ?? {}) as NotificationParams;
    const result = await sendPushToUser(n.user, {
      title: n.title,
      body: n.body,
      url: params.bookingId ? `/bookings/${params.bookingId}` : '/notifications',
      tag: `mybus-${n.type}-${params.pnr ?? String(n._id)}`,
      lang: n.language,
    });
    return result.outcome === 'sent' ? { status: 'sent', transport: `webpush×${result.delivered}` } : { status: 'skipped', skipReason: 'no_subscription' };
  },
};

/** Booking, schedule and reminder messages are the traveller's record and safety information: always kept in-app. */
export const CRITICAL_TYPES: readonly NotificationType[] = ['booking_confirmed', 'booking_cancelled', 'schedule_changed', 'journey_reminder'];

export interface NotifyOptions {
  bookingId?: Types.ObjectId | string;
  pnr?: string | null;
  emailTo?: string | null;
  /** Idempotency key: if a notification with this key exists, nothing is created (returns null). */
  dedupeKey?: string;
  /** Caller runs dispatch() itself (batched sends); otherwise delivery starts in the background. */
  deferDispatch?: boolean;
}

/**
 * Creates a notification for a user in their language and delivers it on every enabled channel.
 * Returns as soon as the record exists: delivery runs in the background and never blocks or fails the caller.
 */
export async function notify(
  userId: Types.ObjectId | string,
  type: NotificationType,
  params: NotificationParams,
  opts: NotifyOptions = {},
): Promise<NotificationDoc | null> {
  const user = await User.findById(userId);
  if (!user) return null;
  const language = isLang(user.language) ? user.language : DEFAULT_LANGUAGE;
  const prefs: { email?: boolean; push?: boolean; inApp?: boolean; promotional?: boolean } = user.notificationPreferences ?? {};
  const rendered = renderNotification(type, language, params, user.name);
  const hasPush = prefs.push !== false && (await PushSubscription.exists({ user: user._id })) !== null;

  const promoOptOut = type === 'promotion' && !prefs.promotional;
  const inAppOn = CRITICAL_TYPES.includes(type) || prefs.inApp !== false;
  const delivery = (channel: Channel, enabled: boolean, missing?: 'no_subscription') => {
    if (promoOptOut) return { channel, status: 'skipped', skipReason: 'promotions_opt_out' };
    if (!enabled) return { channel, status: 'skipped', skipReason: 'preference_off' };
    if (missing) return { channel, status: 'skipped', skipReason: missing };
    return { channel, status: 'pending' };
  };
  const inbox = inAppOn && !promoOptOut;

  let notification: NotificationDoc;
  try {
    notification = await Notification.create({
      user: user._id,
      type,
      templateKey: `notify.${type}`,
      params,
      language,
      title: rendered.title,
      body: rendered.body,
      emailTo: opts.emailTo || user.email,
      booking: opts.bookingId,
      pnr: opts.pnr ?? params.pnr,
      inbox,
      dedupeKey: opts.dedupeKey,
      deliveries: [
        delivery('in_app', inAppOn),
        delivery('email', prefs.email !== false),
        delivery('push', prefs.push !== false, hasPush ? undefined : 'no_subscription'),
      ],
    });
  } catch (err) {
    if (opts.dedupeKey && (err as { code?: number }).code === 11000) return null; // already sent
    throw err;
  }

  // Live update for every open tab of this user (in-app channel).
  if (inbox) {
    const unread = await countUnread(user._id);
    publish(String(user._id), 'notification', { notification: publicNotification(notification.toObject() as NotificationLean), unread });
  }

  if (!opts.deferDispatch) {
    setImmediate(() => {
      dispatch(notification._id).catch((err) => console.error('[notify] dispatch failed', err));
    });
  }
  return notification;
}

/** Unread notifications shown in the user's bell / history. */
export const countUnread = (user: Types.ObjectId | string) => Notification.countDocuments({ user, read: false, inbox: { $ne: false } });

/**
 * Attempts the deliveries of one notification and records each outcome on its channel entry.
 *  - default: pending deliveries (a new notification, or one interrupted by a restart)
 *  - retry:   also failed deliveries whose nextAttemptAt is due (retry worker)
 *  - force:   also any failed delivery, even one that gave up (admin "Retry now")
 */
export async function dispatch(notificationId: Types.ObjectId | string, mode: { retry?: boolean; force?: boolean } = {}): Promise<void> {
  const n = await Notification.findById(notificationId);
  if (!n) return;
  const user = await User.findById(n.user);
  if (!user) return;
  const now = new Date();

  for (const d of n.deliveries) {
    const dueRetry = mode.retry && d.status === 'failed' && !d.gaveUp && (!d.nextAttemptAt || d.nextAttemptAt <= now);
    const forced = mode.force && d.status === 'failed';
    if (d.status !== 'pending' && !dueRetry && !forced) continue;

    if (d.status === 'failed') {
      // Claim the delivery so overlapping workers never send it twice.
      const claimed = await Notification.updateOne(
        { _id: n._id, deliveries: { $elemMatch: { channel: d.channel, status: 'failed' } } },
        { $set: { 'deliveries.$.status': 'pending' } },
      );
      if (!claimed.modifiedCount) continue;
    }

    const where = { _id: n._id, 'deliveries.channel': d.channel };
    try {
      const result = await SENDERS[d.channel](n, user);
      if (result.status === 'sent') {
        await Notification.updateOne(where, {
          $set: { 'deliveries.$.status': 'sent', 'deliveries.$.sentAt': new Date(), 'deliveries.$.transport': result.transport, 'deliveries.$.gaveUp': false },
          $inc: { 'deliveries.$.attempts': 1 },
          $unset: { 'deliveries.$.lastError': 1, 'deliveries.$.nextAttemptAt': 1 },
        });
      } else {
        await Notification.updateOne(where, {
          $set: { 'deliveries.$.status': 'skipped', 'deliveries.$.skipReason': result.skipReason },
          $unset: { 'deliveries.$.nextAttemptAt': 1 },
        });
      }
    } catch (err) {
      const attempts = (d.attempts ?? 0) + 1;
      const gaveUp = attempts >= MAX_ATTEMPTS;
      await Notification.updateOne(where, {
        $set: {
          'deliveries.$.status': 'failed',
          'deliveries.$.lastError': (err instanceof Error ? err.message : String(err)).slice(0, 300),
          'deliveries.$.gaveUp': gaveUp,
          'deliveries.$.nextAttemptAt': gaveUp ? null : new Date(Date.now() + RETRY_DELAYS_MS[attempts - 1]),
        },
        $inc: { 'deliveries.$.attempts': 1 },
      });
      console.error(`[notify] ${d.channel} attempt ${attempts}/${MAX_ATTEMPTS} failed for ${n._id}: ${err instanceof Error ? err.message : err}${gaveUp ? ' (giving up)' : ''}`);
    }
  }
}

/** Retry worker: re-dispatches failed email/push deliveries whose next attempt is due. */
export async function processDueRetries(): Promise<number> {
  const due = await Notification.find({
    deliveries: { $elemMatch: { status: 'failed', gaveUp: { $ne: true }, nextAttemptAt: { $lte: new Date() } } },
  })
    .select('_id')
    .limit(100)
    .lean();
  for (const { _id } of due) await dispatch(_id, { retry: true });
  return due.length;
}

/** On server start: finish deliveries that were still pending when the process stopped. */
export async function resumePending(): Promise<number> {
  const pending = await Notification.find({ 'deliveries.status': 'pending', createdAt: { $lt: STARTED_AT } }).select('_id').limit(500).lean();
  for (const { _id } of pending) await dispatch(_id);
  return pending.length;
}
