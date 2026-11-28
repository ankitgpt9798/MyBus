import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { t } from '../i18n';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type MailTransport = 'brevo-api' | 'smtp' | 'console';

export interface MailResult {
  delivered: boolean; // true when handed to Brevo or an SMTP server
  messageId?: string;
  /** suppressed: reserved / non-routable recipient, printed to the console instead of being sent */
  transport: MailTransport | 'suppressed';
}

/** A failed send; the message never contains credentials (it becomes a delivery's lastError). */
export class MailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

// Reserved / non-routable recipients (RFC 2606 / 6761 names and the example.* domains). Real SMTP sends to them
// can only bounce, which hurts the sender reputation, so they are never sent (demo accounts use @mybus.local).
const RESERVED_TLDS = ['local', 'test', 'invalid', 'example', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

export function isUndeliverableAddress(email: string | null | undefined): boolean {
  const domain = String(email ?? '').trim().toLowerCase().split('@')[1] ?? '';
  if (!domain || !domain.includes('.')) return true; // missing or single-label domain
  if (RESERVED_TLDS.includes(domain.split('.').pop()!)) return true;
  return RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

let transporter: Transporter | null = null;

/** Brevo's HTTPS API when BREVO_API_KEY is set, otherwise SMTP when SMTP_HOST is set, otherwise the console. */
export function mailTransport(): MailTransport {
  if (env.brevo.apiKey) return 'brevo-api';
  return env.smtp.host ? 'smtp' : 'console';
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transporter;
}

/** "MyBus <no-reply@example.org>" or a bare address → Brevo's sender object. */
export function parseSender(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { ...(m[1].trim() && { name: m[1].trim() }), email: m[2].trim() };
  return { email: from.trim() };
}

/** POST /v3/smtp/email with a 15 s timeout. Any failure throws a MailError (Brevo's code and message, never the key). */
async function sendViaBrevo(msg: MailMessage): Promise<MailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.brevo.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${env.brevo.apiBase}/v3/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': env.brevo.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: parseSender(env.smtp.from), to: [{ email: msg.to }], subject: msg.subject, htmlContent: msg.html, textContent: msg.text }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new MailError(`Brevo API did not answer within ${env.brevo.timeoutMs / 1000} s`);
    const cause = (err as { cause?: { code?: string } })?.cause?.code;
    throw new MailError(`Brevo API unreachable${cause ? ` (${cause})` : ''}`);
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => null)) as { messageId?: string; code?: string; message?: string } | null;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) console.error("[mail] Brevo API rejected the key (check BREVO_API_KEY and Brevo's authorised IPs)");
    const detail = `${body?.code ?? 'error'}: ${String(body?.message ?? res.statusText).slice(0, 200)}`;
    throw new MailError(`Brevo API ${res.status} ${detail}`, res.status, body?.code);
  }
  return { delivered: true, messageId: body?.messageId, transport: 'brevo-api' };
}

/**
 * Sends with the configured transport (Brevo API, SMTP, or the console in development). Throws on a failed send.
 * Reserved / non-routable recipients are never sent: the email is printed to the console instead.
 */
export async function sendMail(msg: MailMessage): Promise<MailResult> {
  if (isUndeliverableAddress(msg.to)) {
    console.log(`
[mail:suppressed] To: ${msg.to} (reserved address, not sent)
Subject: ${msg.subject}
${msg.text}
`);
    return { delivered: false, transport: 'suppressed' };
  }
  const transport = mailTransport();
  if (transport === 'console') {
    console.log(`\n[mail:console] To: ${msg.to}\nSubject: ${msg.subject}\n${msg.text}\n`);
    return { delivered: false, transport: 'console' };
  }
  if (transport === 'brevo-api') return sendViaBrevo(msg);
  const info = await getTransporter().sendMail({ from: env.smtp.from, ...msg });
  return { delivered: true, messageId: info.messageId, transport: 'smtp' };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Shared, localized email layout. `paragraphs` are plain text; `action` renders a button. */
export function renderEmail(
  lang: string,
  opts: {
    name: string;
    paragraphs: string[];
    details?: { label: string; value: string }[];
    action?: { label: string; url: string };
    note?: string;
  },
): { html: string; text: string } {
  const greeting = t(lang, 'email.greeting', { name: opts.name });
  const signature = t(lang, 'email.signature');
  const footer = t(lang, 'email.footer');
  const body = opts.paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join('');
  // Key/value table (booking details). Rows stack nicely on narrow mail clients.
  const details = opts.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-collapse:collapse;font-size:14px">${opts.details
        .map(
          (d) =>
            `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid #eee;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(d.label)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:600">${escapeHtml(d.value)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const button = opts.action
    ? `<p style="margin:24px 0"><a href="${opts.action.url}" style="background:#cc444c;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(opts.action.label)}</a></p>`
    : '';
  const note = opts.note ? `<p style="color:#666;font-size:13px">${escapeHtml(opts.note)}</p>` : '';
  const html = `<div style="font-family:Arial,'Nirmala UI','Noto Sans',sans-serif;width:100%;max-width:560px;margin:auto;color:#222;line-height:1.5">
<div style="background:#cc444c;color:#fff;padding:16px 20px;font-size:20px;font-weight:700;border-radius:8px 8px 0 0">MyBus</div>
<div style="border:1px solid #eee;border-top:0;padding:20px;border-radius:0 0 8px 8px">
<p style="margin:0 0 14px">${escapeHtml(greeting)}</p>${body}${details}${button}${note}
<p style="margin:20px 0 0">${signature}</p></div>
<p style="color:#999;font-size:12px;text-align:center">${escapeHtml(footer)}</p></div>`;
  const text = [
    greeting,
    '',
    ...opts.paragraphs,
    ...(opts.details?.length ? ['', ...opts.details.map((d) => `${d.label}: ${d.value}`)] : []),
    ...(opts.action ? ['', `${opts.action.label}: ${opts.action.url}`] : []),
    ...(opts.note ? ['', opts.note] : []),
    '',
    signature.replace('<br>', '\n'),
  ].join('\n');
  return { html, text };
}
