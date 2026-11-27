import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { SUPPORTED_LANGUAGES, t } from '../i18n';
import { Post } from '../models/Post';
import { SHARE_NETWORKS, UTM } from '../services/community.rules';
import { excerpt } from '../services/community.service';
import { StoredPhoto, shareImageUrl } from '../services/photo-storage.service';
import { isObjectId } from '../utils/validate';

/**
 * GET /share/posts/:id: a tiny server-rendered page with Open Graph / Twitter Card tags, so WhatsApp, Facebook,
 * X and Telegram can show a preview card for a shared post. People are sent on to the post in the web app
 * (meta refresh + script); link-preview bots get the tags only. Everything is HTML-escaped.
 */

const BOTS = /facebookexternalhit|facebot|twitterbot|whatsapp|telegrambot|linkedinbot|slackbot|discordbot|pinterest|skypeuripreview|googlebot|bingbot|embedly|redditbot|applebot/i;
const LOCALES: Record<string, string> = { en: 'en_IN', hi: 'hi_IN', mr: 'mr_IN', bn: 'bn_IN', te: 'te_IN' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Only known UTM values are passed on to the app. */
function utmQuery(query: Request['query']): string {
  const params = new URLSearchParams();
  const source = SHARE_NETWORKS.find((n) => n === query.utm_source);
  if (source) {
    params.set('utm_source', source);
    params.set('utm_medium', UTM.medium);
    params.set('utm_campaign', UTM.campaign);
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}

function securityHeaders(res: Response, nonce?: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; img-src 'self' https://res.cloudinary.com data:; style-src 'nonce-${nonce ?? 'none'}'; script-src 'nonce-${nonce ?? 'none'}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  );
}

const STYLE = 'body{margin:0;padding:2rem 1rem;font-family:system-ui,sans-serif;line-height:1.5;color:#1f2430;background:#f6f7fb}main{max-width:36rem;margin:0 auto}a{color:#c73a3f;font-weight:600}';

export async function sharePage(req: Request, res: Response) {
  const id = String(req.params.id);
  const post = isObjectId(id) ? await Post.findById(id).select('title body photos language status createdAt').lean() : null;
  const nonce = crypto.randomBytes(16).toString('base64');
  securityHeaders(res, nonce);

  if (!post || post.status !== 'visible') {
    const lang = req.acceptsLanguages(...SUPPORTED_LANGUAGES) || 'en';
    res.status(404).setHeader('Cache-Control', 'no-store');
    res.send(
      `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
        `<title>${esc(t(lang, 'share.notFoundTitle'))} · MyBus</title><style nonce="${nonce}">${STYLE}</style></head>` +
        `<body><main><h1>${esc(t(lang, 'share.notFoundTitle'))}</h1><p>${esc(t(lang, 'share.notFoundText'))}</p>` +
        `<p><a href="${esc(`${env.frontendUrl}/community`)}">${esc(t(lang, 'share.backToCommunity'))}</a></p></main></body></html>`,
    );
    return;
  }
  const lang = post.language ?? 'en';

  const target = `${env.frontendUrl}/community/posts/${id}${utmQuery(req.query)}`;
  const canonical = `${env.frontendUrl}/share/posts/${id}`;
  const description = excerpt(post.body.replace(/\s+/g, ' ').trim(), 200);
  // Absolute URL so link previews work: a Cloudinary image, or the photo served by this site.
  const photo = post.photos[0] as StoredPhoto | undefined;
  const image = photo ? shareImageUrl(photo) : null;
  const isBot = BOTS.test(String(req.headers['user-agent'] ?? ''));
  const meta = (attr: 'property' | 'name', key: string, value: string) => `<meta ${attr}="${key}" content="${esc(value)}">`;

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(post.title)} · MyBus</title>`,
    meta('name', 'description', description),
    `<link rel="canonical" href="${esc(canonical)}">`,
    meta('property', 'og:type', 'article'),
    meta('property', 'og:site_name', 'MyBus'),
    meta('property', 'og:title', post.title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', canonical),
    meta('property', 'og:locale', LOCALES[lang] ?? 'en_IN'),
    ...(image ? [meta('property', 'og:image', image), meta('property', 'og:image:alt', photo!.alt || post.title)] : []),
    meta('property', 'article:published_time', new Date(post.createdAt).toISOString()),
    meta('name', 'twitter:card', image ? 'summary_large_image' : 'summary'),
    meta('name', 'twitter:title', post.title),
    meta('name', 'twitter:description', description),
    ...(image ? [meta('name', 'twitter:image', image)] : []),
    ...(isBot ? [] : [`<meta http-equiv="refresh" content="0;url=${esc(target)}">`]),
    `<style nonce="${nonce}">${STYLE}</style>`,
  ];
  const redirect = isBot ? '' : `<script nonce="${nonce}">location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')});</script>`;

  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(
    `<!doctype html><html lang="${esc(lang)}"><head>${head.join('')}</head>` +
      `<body><main><p>${esc(t(lang, 'share.community'))}</p><h1>${esc(post.title)}</h1><p>${esc(description)}</p>` +
      `<p><a href="${esc(target)}">${esc(t(lang, 'share.readPost'))}</a></p></main>${redirect}</body></html>`,
  );
}
