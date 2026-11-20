import { completeArrivedBookings, expireStaleHolds } from '../services/booking.service';

const INTERVAL_MS = 60 * 1000;
let timer: NodeJS.Timeout | null = null;

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
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  timer = null;
}
