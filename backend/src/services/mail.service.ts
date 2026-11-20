import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { t } from '../i18n';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailResult {
  delivered: boolean; // true when handed to an SMTP server
  messageId?: string;
  transport: 'smtp' | 'console';
}

let transporter: Transporter | null = null;

export const smtpConfigured = () => Boolean(env.smtp.host);

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

/** Sends through SMTP when configured; otherwise prints the email to the console (dev mode). Throws on SMTP failure. */
export async function sendMail(msg: MailMessage): Promise<MailResult> {
  if (!smtpConfigured()) {
    console.log(`\n[mail:console] To: ${msg.to}\nSubject: ${msg.subject}\n${msg.text}\n`);
    return { delivered: false, transport: 'console' };
  }
  const info = await getTransporter().sendMail({ from: env.smtp.from, ...msg });
  return { delivered: true, messageId: info.messageId, transport: 'smtp' };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Shared, localized email layout. `paragraphs` are plain text; `action` renders a button. */
export function renderEmail(
  lang: string,
  opts: { name: string; paragraphs: string[]; action?: { label: string; url: string }; note?: string },
): { html: string; text: string } {
  const greeting = t(lang, 'email.greeting', { name: opts.name });
  const signature = t(lang, 'email.signature');
  const footer = t(lang, 'email.footer');
  const body = opts.paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join('');
  const button = opts.action
    ? `<p style="margin:24px 0"><a href="${opts.action.url}" style="background:#d84e55;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(opts.action.label)}</a></p>`
    : '';
  const note = opts.note ? `<p style="color:#666;font-size:13px">${escapeHtml(opts.note)}</p>` : '';
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
<div style="background:#d84e55;color:#fff;padding:16px 20px;font-size:20px;font-weight:700;border-radius:8px 8px 0 0">MyBus</div>
<div style="border:1px solid #eee;border-top:0;padding:20px;border-radius:0 0 8px 8px">
<p style="margin:0 0 14px">${escapeHtml(greeting)}</p>${body}${button}${note}
<p style="margin:20px 0 0">${signature}</p></div>
<p style="color:#999;font-size:12px;text-align:center">${escapeHtml(footer)}</p></div>`;
  const text = [
    greeting,
    '',
    ...opts.paragraphs,
    ...(opts.action ? ['', `${opts.action.label}: ${opts.action.url}`] : []),
    ...(opts.note ? ['', opts.note] : []),
    '',
    signature.replace('<br>', '\n'),
  ].join('\n');
  return { html, text };
}
