import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * Minimal Cloudinary client over its REST API (no SDK): signed image upload and destroy.
 * Only images inside the configured folder are ever created or deleted.
 */

export class CloudinaryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined>;

/**
 * Cloudinary request signature: every parameter except file, cloud_name, resource_type and api_key, sorted by
 * name, joined as key=value with "&", then the API secret appended and hashed with SHA-1 (hex).
 */
export function signParams(params: Params, secret: string): string {
  const toSign = Object.keys(params)
    .filter((k) => !['file', 'cloud_name', 'resource_type', 'api_key'].includes(k) && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + secret).digest('hex');
}

/** Cloudinary's message without anything that echoes the signed parameters (it appends "String to sign - ..."). */
const safeMessage = (message: unknown) =>
  String(message ?? '')
    .replace(/String to sign[\s\S]*$/i, '')
    .trim()
    .slice(0, 160);

async function call(action: 'upload' | 'destroy', params: Params, file?: { data: Buffer; name: string }): Promise<Record<string, unknown>> {
  const { cloudName, apiKey, apiSecret, apiBase, timeoutMs } = env.photos.cloudinary;
  const signed: Params = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) if (v !== undefined && v !== '') form.append(k, String(v));
  form.append('api_key', apiKey);
  form.append('signature', signParams(signed, apiSecret));
  if (file) form.append('file', new Blob([new Uint8Array(file.data)]), file.name);
  let res: Response;
  try {
    res = await fetch(`${apiBase}/v1_1/${encodeURIComponent(cloudName)}/image/${action}`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new CloudinaryError(0, timedOut ? `no answer within ${timeoutMs} ms` : 'network error');
  }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok || !body) throw new CloudinaryError(res.status, safeMessage(body?.error?.message) || `HTTP ${res.status}`);
  return body as Record<string, unknown>;
}

export interface UploadedImage {
  publicId: string;
  url: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  existing: boolean;
}

/**
 * Uploads already checked and cleaned image bytes as <folder>/<id>. With overwrite off, uploading an id that already
 * exists returns the existing image instead of a copy (this makes the photo migration safe to re-run).
 */
export async function uploadImage(data: Buffer, opts: { id: string; ext: string; tags: string[] }): Promise<UploadedImage> {
  const body = await call(
    'upload',
    { folder: env.photos.cloudinary.folder, public_id: opts.id, tags: opts.tags.join(','), overwrite: false },
    { data, name: `${opts.id}.${opts.ext}` },
  );
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (typeof body.public_id !== 'string' || typeof body.secure_url !== 'string') throw new CloudinaryError(502, 'unexpected upload response');
  return {
    publicId: body.public_id,
    url: body.secure_url,
    width: num(body.width),
    height: num(body.height),
    format: typeof body.format === 'string' ? body.format : undefined,
    bytes: num(body.bytes),
    existing: body.existing === true,
  };
}

/** Deletes one image (and purges it from the CDN). An image that is already gone counts as deleted. */
export async function destroyImage(publicId: string): Promise<void> {
  const folder = env.photos.cloudinary.folder;
  if (!publicId.startsWith(`${folder}/`)) throw new CloudinaryError(400, 'refusing to delete an image outside the MyBus folder');
  const body = await call('destroy', { public_id: publicId, invalidate: true });
  if (body.result !== 'ok' && body.result !== 'not found') throw new CloudinaryError(502, `unexpected destroy result ${safeMessage(body.result)}`);
}

/**
 * Delivery URL with on-the-fly optimisation: automatic format and quality, longest side limited to `width`
 * (aspect ratio kept, never upscaled). Non-Cloudinary URLs are returned unchanged.
 */
export function deliveryUrl(secureUrl: string, width: number, format: 'auto' | 'jpg' = 'auto'): string {
  return secureUrl.replace('/image/upload/', `/image/upload/c_limit,w_${width},f_${format},q_auto/`);
}
