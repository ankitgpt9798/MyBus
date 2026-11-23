import { env } from '../config/env';
import { completeArrivedBookings, expireStaleHolds } from '../services/booking.service';
import { processDueRetries, resumePending } from '../services/notification.service';
import { resumePromotions } from '../services/promotion.service';
import { processReminders } from '../services/reminder.service';

const INTERVAL_MS = 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let retrying = false;
let reminderTimer: NodeJS.Timeout | null = null;
let reminding = false;

/** Journey reminder scheduler (~24 h and ~2 h before departure). */
async function reminderTick() {
  if (reminding) return;
  reminding = true;
  try {
    const n = await processReminders();
    if (n) console.log(`[jobs] sent ${n} journey reminder(s)`);
  } catch (err) {
    console.error('[jobs] journey reminders failed', err);
  } finally {
    reminding = false;
  }
}

/** Notification retry worker: failed email/push deliveries whose next attempt is due. */
async function retryTick() {
  if (retrying) return; // never overlap runs
  retrying = true;
  try {
    const n = await processDueRetries();
    if (n) console.log(`[jobs] retried deliveries of ${n} notification(s)`);
  } catch (err) {
    console.error('[jobs] notification retry failed', err);
  } finally {
    retrying = false;
  }
}

async function tick() {
  try {
    const expired = await expireStaleHolds();
    const completed = await completeArrivedBookings();
    if (expired || completed) console.log(`[jobs] expired ${expired} holds, completed ${completed} bookings`);
  } catch (err) {
    console.error('[jobs] booking maintenance failed', err);
  }
}

/** Background maintenance: releases expired seat holds and completes bookings after arrival. */
export function startJobs() {
  void tick();
  timer = setInterval(tick, INTERVAL_MS);
  // Deliveries interrupted by a restart are resumed, then failed ones are retried on schedule.
  resumePending()
    .then((n) => n && console.log(`[jobs] resumed ${n} pending notification(s)`))
    .catch((err) => console.error('[jobs] resuming notifications failed', err));
  retryTimer = setInterval(retryTick, env.notifications.retryIntervalMs);
  void reminderTick();
  reminderTimer = setInterval(reminderTick, env.reminders.intervalMs);
  resumePromotions()
    .then((n) => n && console.log(`[jobs] resumed ${n} offer campaign(s)`))
    .catch((err) => console.error('[jobs] resuming offers failed', err));
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  if (retryTimer) clearInterval(retryTimer);
  if (reminderTimer) clearInterval(reminderTimer);
  timer = retryTimer = reminderTimer = null;
}
