import { Types } from 'mongoose';
import { Booking } from '../models/Booking';
import { Promotion, PromotionDoc } from '../models/Promotion';
import { User } from '../models/User';
import { dispatch, notify } from './notification.service';

export type PromotionTarget = { kind: 'all' } | { kind: 'route'; from: string; to: string } | { kind: 'city'; city: string };

const BATCH_SIZE = 50;
const BATCH_PAUSE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Travellers matched by a target (confirmed or completed bookings), or null for "everyone". */
async function travellers(target: PromotionTarget): Promise<Types.ObjectId[] | null> {
  const travelled = { status: { $in: ['confirmed', 'completed'] as ('confirmed' | 'completed')[] } };
  if (target.kind === 'route') return Booking.distinct('user', { ...travelled, 'journey.from': target.from, 'journey.to': target.to });
  if (target.kind === 'city') return Booking.distinct('user', { ...travelled, $or: [{ 'journey.from': target.city }, { 'journey.to': target.city }] });
  return null;
}

/** Recipients = users matched by the target who opted in to offers. */
async function recipientFilter(target: PromotionTarget) {
  const ids = await travellers(target);
  return { matched: ids ? { _id: { $in: ids } } : {}, optedIn: { ...(ids ? { _id: { $in: ids } } : {}), 'notificationPreferences.promotional': true } };
}

/** Preview before sending: how many users will get the offer, and how many match but have not opted in. */
export async function previewPromotion(target: PromotionTarget): Promise<{ recipients: number; matched: number }> {
  const { matched, optedIn } = await recipientFilter(target);
  const [recipients, all] = await Promise.all([User.countDocuments(optedIn), User.countDocuments(matched)]);
  return { recipients, matched: all };
}

/**
 * Sends an offer to opted-in recipients only (users who did not opt in get no record at all), in batches with a
 * short pause, delivering one notification at a time so SMTP / push services are not flooded. Each send carries a
 * dedupe key, so resuming an interrupted campaign never sends twice.
 */
export async function runPromotion(promotion: PromotionDoc): Promise<void> {
  const target = promotion.target as PromotionTarget;
  const { optedIn } = await recipientFilter(target);
  const params = { title: promotion.title, body: promotion.body, translations: promotion.translations ?? {} };
  let lastId: Types.ObjectId | null = null;
  for (;;) {
    const batch: { _id: Types.ObjectId }[] = await User.find({ ...optedIn, ...(lastId && { _id: { ...(optedIn as { _id?: object })._id, $gt: lastId } }) })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select('_id')
      .lean();
    if (!batch.length) break;
    let created = 0;
    for (const { _id } of batch) {
      const n = await notify(_id, 'promotion', params, { dedupeKey: `promo:${promotion._id}:${_id}`, deferDispatch: true });
      if (!n) continue; // already sent before a restart
      created++;
      await dispatch(n._id).catch((err) => console.error('[promotion] dispatch failed', err));
    }
    await Promotion.updateOne({ _id: promotion._id }, { $inc: { sent: created } });
    lastId = batch[batch.length - 1]._id;
    await sleep(BATCH_PAUSE_MS);
  }
  await Promotion.updateOne({ _id: promotion._id }, { $set: { status: 'sent', completedAt: new Date() } });
}

/** On server start: finish campaigns that were still sending. */
export async function resumePromotions(): Promise<number> {
  const open = await Promotion.find({ status: 'sending' });
  for (const p of open) void runPromotion(p).catch((err) => console.error('[promotion] resume failed', err));
  return open.length;
}
