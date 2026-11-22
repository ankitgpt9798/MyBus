import { env } from '../config/env';
import { completeArrivedBookings, expireStaleHolds } from '../services/booking.service';
import { processDueRetries, resumePending } from '../services/notification.service';

const INTERVAL_MS = 60 * 1000;
let timer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let retrying = false;

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
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  if (retryTimer) clearInterval(retryTimer);
  timer = retryTimer = null;
}
