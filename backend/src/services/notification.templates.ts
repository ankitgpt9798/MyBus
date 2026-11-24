import { env } from '../config/env';
import { cityName, formatDateTime, formatMoney, formatTime, t, tp } from '../i18n';
import type { NotificationType } from '../models/Notification';
import { renderEmail } from './mail.service';

/** Raw values stored with a notification; everything language-specific is derived from these at render time. */
export interface NotificationParams {
  bookingId?: string;
  pnr?: string;
  from?: string;
  to?: string;
  departureTime?: string; // ISO
  oldDepartureTime?: string; // ISO (schedule changes)
  arrivalTime?: string; // ISO
  oldArrivalTime?: string; // ISO (schedule changes)
  reminderKind?: '24h' | '2h';
  seats?: string[];
  ladiesSeats?: string[];
  boardingPoint?: string;
  boardingTime?: string; // ISO
  amount?: number;
  refundAmount?: number;
  refundPercent?: number;
  paid?: boolean;
  tripCancelled?: boolean;
  title?: string; // promotions: admin-written text (English)
  body?: string;
  /** Promotions: optional versions per language; missing ones fall back to the English title/body. */
  translations?: Partial<Record<string, { title: string; body: string }>>;
}

/** Offer text in a language, falling back to English. */
export function promotionText(params: NotificationParams, lang: string): { title: string; body: string } {
  const tr = params.translations?.[lang];
  return tr?.title?.trim() && tr.body?.trim() ? { title: tr.title, body: tr.body } : { title: params.title ?? '', body: params.body ?? '' };
}

export interface RenderedNotification {
  title: string;
  body: string;
  email: { subject: string; html: string; text: string };
}

/** Renders a notification (in-app title/body + full email) in one language. Deterministic, so retries re-render it. */
export function renderNotification(type: NotificationType, lang: string, params: NotificationParams, userName: string): RenderedNotification {
  const k = (key: string, extra: Record<string, string | number> = {}) => t(lang, `notify.${type}.${key}`, { ...vars, ...extra });
  const label = (key: string) => t(lang, `notify.labels.${key}`);
  const seatCount = params.seats?.length ?? 0;
  const promo = type === 'promotion' ? promotionText(params, lang) : { title: '', body: '' };
  const vars: Record<string, string | number> = {
    pnr: params.pnr ?? '',
    from: params.from ? cityName(lang, params.from) : '',
    to: params.to ? cityName(lang, params.to) : '',
    date: params.departureTime ? formatDateTime(lang, params.departureTime) : '',
    oldDate: params.oldDepartureTime ? formatDateTime(lang, params.oldDepartureTime) : '',
    boarding: params.boardingPoint ?? '',
    boardingTime: params.boardingTime ? formatTime(lang, params.boardingTime) : '',
    seats: (params.seats ?? []).join(', '),
    title: promo.title,
    body: promo.body,
  };

  const details: { label: string; value: string }[] = [];
  const add = (key: string, value: string | undefined) => {
    // "Seat" / "Seats" follows the number of seats on the booking.
    if (value) details.push({ label: key === 'seats' ? tp(lang, 'notify.labels.seats', seatCount) : label(key), value });
  };
  const seats = (params.seats ?? [])
    .map((s) => (params.ladiesSeats?.includes(s) ? `${s} (${label('womens_seat')})` : s))
    .join(', ');
  const route = vars.from && vars.to ? `${vars.from} → ${vars.to}` : undefined;
  const boarding = params.boardingPoint
    ? params.boardingTime
      ? `${params.boardingPoint} · ${formatDateTime(lang, params.boardingTime)}`
      : params.boardingPoint
    : undefined;

  let intro = k('intro');
  switch (type) {
    case 'booking_confirmed':
      add('pnr', params.pnr);
      add('route', route);
      add('departure', String(vars.date));
      add('seats', seats);
      add('boarding', boarding);
      add('amount', params.amount !== undefined ? formatMoney(lang, params.amount) : undefined);
      break;
    case 'booking_cancelled': {
      if (params.tripCancelled) intro = k('trip_cancelled');
      const refund = !params.paid
        ? k('nothing_charged')
        : params.refundAmount
          ? k('refund_value', { amount: formatMoney(lang, params.refundAmount), percent: params.refundPercent ?? 0 })
          : k('no_refund');
      add('pnr', params.pnr);
      add('route', route);
      add('departure', String(vars.date));
      add('seats', seats);
      add('refund', refund);
      break;
    }
    case 'schedule_changed':
      add('pnr', params.pnr);
      add('route', route);
      add('new_departure', String(vars.date));
      add('old_departure', params.oldDepartureTime ? formatDateTime(lang, params.oldDepartureTime) : undefined);
      add('new_arrival', params.arrivalTime ? formatDateTime(lang, params.arrivalTime) : undefined);
      add('old_arrival', params.oldArrivalTime ? formatDateTime(lang, params.oldArrivalTime) : undefined);
      add('boarding', boarding);
      break;
    case 'journey_reminder':
      if (params.reminderKind === '2h') intro = k('intro_soon');
      add('pnr', params.pnr);
      add('route', route);
      add('departure', String(vars.date));
      add('boarding', boarding);
      add('seats', seats);
      break;
    case 'promotion':
      break;
  }

  const { html, text } = renderEmail(lang, {
    name: userName,
    paragraphs: [intro],
    details,
    action: params.bookingId ? { label: label('view_booking'), url: `${env.frontendUrl}/bookings/${params.bookingId}` } : undefined,
    note: t(lang, 'notify.prefs_note'),
  });
  const body = type === 'journey_reminder' ? tp(lang, `notify.${type}.body`, seatCount, vars) : k('body');
  return { title: k('title'), body, email: { subject: k('subject'), html, text } };
}
