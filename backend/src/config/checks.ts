import { env } from './env';

const EXAMPLE_SECRETS = new Set(['change-me-to-a-long-random-string', 'changeme', 'secret', 'mybus', 'jwt-secret']);
const isLocal = (url: string) => /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);

/**
 * Settings that work locally but cause trouble on a hosted server (NODE_ENV=production). Only warnings: the server
 * still starts. Values are never included in the messages.
 */
export function productionWarnings(): string[] {
  if (env.nodeEnv !== 'production') return [];
  const warnings: string[] = [];
  if (env.photos.storage === 'local') {
    warnings.push('community photos are stored on the server disk (PHOTO_STORAGE=local): hosting platforms like Render wipe it on every deploy or restart; set the CLOUDINARY_* variables');
  }
  if (!env.brevo.apiKey && env.smtp.host) {
    warnings.push("email goes out over SMTP only: SMTP ports are blocked on Render's free plan; set BREVO_API_KEY to send through Brevo's HTTPS API");
  }
  if (!env.brevo.apiKey && !env.smtp.host) warnings.push('no email transport is configured (BREVO_API_KEY or SMTP_HOST): emails are only printed to the log');
  if (!env.vapid.publicKey || !env.vapid.privateKey) {
    warnings.push('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set: keys generated on the server are lost on the next deploy, which breaks existing push subscriptions');
  }
  if (!env.vapid.subject) warnings.push('VAPID_SUBJECT is not set: push services get mailto:<ADMIN_EMAIL>; set it to the site URL or a real email address');
  if (isLocal(env.frontendUrl)) warnings.push('FRONTEND_URL points to localhost: links in emails and shared posts will not open the deployed site');
  if (env.corsOrigins.some((o) => typeof o === 'string' && isLocal(o))) warnings.push('CORS_ORIGINS includes a localhost origin');
  if (!env.corsOrigins.some((o) => typeof o !== 'string' || !isLocal(o))) warnings.push('CORS_ORIGINS has no public origin: the deployed web app cannot call the API');
  if (env.jwtSecret.length < 32 || EXAMPLE_SECRETS.has(env.jwtSecret.toLowerCase())) {
    warnings.push('JWT_SECRET is weak or the example value: use a long random string (32 characters or more)');
  }
  return warnings;
}
