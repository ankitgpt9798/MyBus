import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { PushSubscription } from '../models/PushSubscription';

const KEY_FILE = path.resolve(__dirname, '../../.vapid-keys.json');
let vapid: { publicKey: string; privateKey: string; subject: string } | null = null;

/**
 * VAPID keys come from the environment; otherwise they are generated once and stored in
 * backend/.vapid-keys.json (gitignored), so existing browser subscriptions keep working across restarts.
 */
export function vapidKeys() {
  if (vapid) return vapid;
  let { publicKey, privateKey } = env.vapid;
  if (!publicKey || !privateKey) {
    try {
      ({ publicKey, privateKey } = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')));
    } catch {
      ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
      fs.writeFileSync(KEY_FILE, JSON.stringify({ publicKey, privateKey }, null, 2));
      console.log(`[push] generated VAPID keys in ${KEY_FILE} (set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY to use your own)`);
    }
  }
  const subject = env.vapid.subject || `mailto:${env.admin.email}`;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapid = { publicKey, privateKey, subject };
  return vapid;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  lang: string;
}

export type PushResult = { outcome: 'sent'; delivered: number } | { outcome: 'no_subscription' };

/**
 * Sends an encrypted push to every subscription of the user. Subscriptions the push service reports as
 * gone (404/410) are deleted. Throws when nothing could be delivered because of another error.
 */
export async function sendPushToUser(userId: Types.ObjectId | string, payload: PushPayload): Promise<PushResult> {
  vapidKeys();
  const subs = await PushSubscription.find({ user: userId });
  if (!subs.length) return { outcome: 'no_subscription' };

  let delivered = 0;
  const errors: string[] = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.keys!.p256dh, auth: sub.keys!.auth } }, JSON.stringify(payload), {
        TTL: 24 * 60 * 60,
        urgency: 'normal',
        topic: payload.tag.slice(0, 32),
      });
      delivered++;
      await PushSubscription.updateOne({ _id: sub._id }, { $set: { lastUsedAt: new Date() } });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await PushSubscription.deleteOne({ _id: sub._id }); // expired / unsubscribed in the browser
      } else {
        errors.push(status ? `push service returned ${status}` : err instanceof Error ? err.message : String(err));
      }
    }
  }
  if (delivered) return { outcome: 'sent', delivered };
  if (errors.length) throw new Error(errors.join('; '));
  return { outcome: 'no_subscription' }; // every subscription was gone
}
