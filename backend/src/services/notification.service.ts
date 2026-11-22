import { Types } from 'mongoose';
import { DEFAULT_LANGUAGE, isLang } from '../i18n';
import { Channel, Notification, NotificationDoc, NotificationType } from '../models/Notification';
import { User, UserDoc } from '../models/User';
import { sendMail } from './mail.service';
import { NotificationParams, renderNotification } from './notification.templates';

/** Wait before the next attempt after the n-th failure (used by the retry worker). */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

type Sender = (n: NotificationDoc, user: UserDoc) => Promise<{ transport: string }>;

const SENDERS: Record<Channel, Sender> = {
  // The stored notification *is* the in-app message (shown in the bell and history).
  in_app: async () => ({ transport: 'inbox' }),
  email: async (n, user) => {
    const { email } = renderNotification(n.type, n.language, (n.params ?? {}) as NotificationParams, user.name);
    const result = await sendMail({ to: n.emailTo || user.email, ...email });
    return { transport: result.transport };
  },
  // Web push is not available yet; push deliveries are recorded as skipped (not_available) and never reach here.
  push: async () => {
    throw new Error('Push channel is not available');
  },
};

/**
 * Creates a notification for a user in their language and delivers it on every enabled channel.
 * Returns as soon as the record exists: delivery runs in the background and never blocks or fails the caller.
 */
export async function notify(
  userId: Types.ObjectId | string,
  type: NotificationType,
  params: NotificationParams,
  opts: { bookingId?: Types.ObjectId | string; pnr?: string | null; emailTo?: string | null } = {},
): Promise<NotificationDoc | null> {
  const user = await User.findById(userId);
  if (!user) return null;
  const language = isLang(user.language) ? user.language : DEFAULT_LANGUAGE;
  const prefs: { email?: boolean; push?: boolean; inApp?: boolean; promotional?: boolean } = user.notificationPreferences ?? {};
  const rendered = renderNotification(type, language, params, user.name);

  const promoOptOut = type === 'promotion' && !prefs.promotional;
  const delivery = (channel: Channel, enabled: boolean, unavailable = false) => {
    if (promoOptOut) return { channel, status: 'skipped', skipReason: 'promotions_opt_out' };
    if (!enabled) return { channel, status: 'skipped', skipReason: 'preference_off' };
    if (unavailable) return { channel, status: 'skipped', skipReason: 'not_available' };
    return { channel, status: 'pending' };
  };

  const notification = await Notification.create({
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
    deliveries: [
      delivery('in_app', prefs.inApp !== false),
      delivery('email', prefs.email !== false),
      delivery('push', prefs.push !== false, true),
    ],
  });

  setImmediate(() => {
    dispatch(notification._id).catch((err) => console.error('[notify] dispatch failed', err));
  });
  return notification;
}

/**
 * Attempts every pending delivery of a notification (and, when `retry` is set, failed ones that are due).
 * Each outcome is written to that channel's delivery entry: sent, or failed with lastError and nextAttemptAt.
 */
export async function dispatch(notificationId: Types.ObjectId | string, retry = false): Promise<void> {
  const n = await Notification.findById(notificationId);
  if (!n) return;
  const user = await User.findById(n.user);
  if (!user) return;

  for (const d of n.deliveries) {
    const due = d.status === 'pending' || (retry && d.status === 'failed' && (!d.nextAttemptAt || d.nextAttemptAt <= new Date()));
    if (!due) continue;
    const where = { _id: n._id, 'deliveries.channel': d.channel };
    try {
      const { transport } = await SENDERS[d.channel](n, user);
      await Notification.updateOne(where, {
        $set: { 'deliveries.$.status': 'sent', 'deliveries.$.sentAt': new Date(), 'deliveries.$.transport': transport },
        $inc: { 'deliveries.$.attempts': 1 },
        $unset: { 'deliveries.$.lastError': 1, 'deliveries.$.nextAttemptAt': 1 },
      });
    } catch (err) {
      const attempts = (d.attempts ?? 0) + 1;
      const delay = RETRY_DELAYS_MS[attempts - 1];
      await Notification.updateOne(where, {
        $set: {
          'deliveries.$.status': 'failed',
          'deliveries.$.lastError': (err instanceof Error ? err.message : String(err)).slice(0, 300),
          // No further attempt once the retry schedule is used up.
          'deliveries.$.nextAttemptAt': delay !== undefined ? new Date(Date.now() + delay) : null,
        },
        $inc: { 'deliveries.$.attempts': 1 },
      });
      console.error(`[notify] ${d.channel} delivery failed for notification ${n._id}:`, err instanceof Error ? err.message : err);
    }
  }
}
