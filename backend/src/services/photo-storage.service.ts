import crypto from 'node:crypto';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { CloudinaryError, deliveryUrl, destroyImage, uploadImage } from './cloudinary.service';
import { ImageType, imageSize } from './image-info';
import { deletePhotos, photoUrl, savePhotos, stripMetadata } from './upload.service';

/**
 * Community photo storage: the local uploads folder or Cloudinary (PHOTO_STORAGE). Photos stored before Cloudinary
 * support have no `storage` field (they are local) and keep their size in `type` / `size`.
 */
export interface StoredPhoto {
  storage?: 'local' | 'cloudinary' | null;
  file?: string | null;
  url?: string | null;
  publicId?: string | null;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  bytes?: number | null;
  type?: string | null;
  size?: number | null;
  seed?: boolean | null;
  alt?: string | null;
}

export const isCloudinary = (p: StoredPhoto) => p.storage === 'cloudinary' && !!p.publicId && !!p.url;

/** Identifies a post's photo when editing (photos to keep): the file name of a local photo, the public id on Cloudinary. */
export const photoKey = (p: StoredPhoto) => (isCloudinary(p) ? p.publicId! : (p.file ?? ''));

const CARD_WIDTH = 800;
const FULL_WIDTH = 1600;
const SHARE_WIDTH = 1200;

/** What the web app gets: an id for editing, a card-size and a full-size URL, the size when known, and the alt text. */
export function photoView(p: StoredPhoto) {
  const local = p.file ? photoUrl(p.file) : '';
  return {
    id: photoKey(p),
    url: isCloudinary(p) ? deliveryUrl(p.url!, CARD_WIDTH) : local,
    fullUrl: isCloudinary(p) ? deliveryUrl(p.url!, FULL_WIDTH) : local,
    width: p.width ?? null,
    height: p.height ?? null,
    alt: p.alt ?? '',
  };
}

/** Absolute image URL for link previews (og:image); on Cloudinary a JPEG of at most 1200 px that any crawler can fetch. */
export function shareImageUrl(p: StoredPhoto): string {
  return isCloudinary(p) ? deliveryUrl(p.url!, SHARE_WIDTH, 'jpg') : `${env.frontendUrl}${photoUrl(p.file ?? '')}`;
}

export interface NewImage {
  data: Buffer;
  type: ImageType;
}

/**
 * Stores already checked images with the configured driver. Camera / GPS metadata is stripped first, so only the
 * cleaned bytes ever leave the server. If one image fails, those already stored are removed again; a Cloudinary
 * failure becomes COMMUNITY_PHOTO_UPLOAD_FAILED.
 */
export async function storeImages(images: NewImage[], opts: { seed?: boolean } = {}): Promise<StoredPhoto[]> {
  if (!images.length) return [];
  const seed = opts.seed ? { seed: true } : {};
  const dims = (img: NewImage) => imageSize(img.data, img.type) ?? {};
  if (env.photos.storage === 'local') {
    const saved = await savePhotos(images.map((img) => ({ buffer: img.data }) as Express.Multer.File), images.map((img) => img.type));
    return saved.map((s, i) => ({ storage: 'local', file: s.file, format: s.type, bytes: s.size, ...dims(images[i]), ...seed }));
  }
  const stored: StoredPhoto[] = [];
  try {
    for (const img of images) {
      const data = stripMetadata(img.data, img.type);
      const id = crypto.randomBytes(16).toString('hex');
      let up;
      try {
        up = await uploadImage(data, { id, ext: img.type, tags: opts.seed ? ['mybus', 'mybus-seed'] : ['mybus'] });
      } catch (err) {
        if (err instanceof CloudinaryError && err.status === 0) deleteLater(`${env.photos.cloudinary.folder}/${id}`);
        throw err;
      }
      const size = imageSize(data, img.type);
      stored.push({ storage: 'cloudinary', url: up.url, publicId: up.publicId, width: up.width ?? size?.width, height: up.height ?? size?.height, format: img.type, bytes: up.bytes ?? data.length, ...seed });
    }
    return stored;
  } catch (err) {
    await removePhotos(stored);
    if (err instanceof CloudinaryError) {
      console.warn(`[photos] Cloudinary upload failed (${err.status ? `HTTP ${err.status}: ` : ''}${err.message})`);
      throw new AppError(502, 'COMMUNITY_PHOTO_UPLOAD_FAILED', 'The photos could not be uploaded, please try again');
    }
    throw err;
  }
}

/**
 * After a timeout Cloudinary may still finish the upload, so the image (whose id we chose) is deleted now and once more
 * a little later, leaving no orphan behind.
 */
function deleteLater(publicId: string): void {
  const attempt = () => destroyImage(publicId).catch(() => undefined);
  void attempt();
  setTimeout(attempt, Math.max(env.photos.cloudinary.timeoutMs * 4, 5_000)).unref();
}

/**
 * Deletes photos: local files, or Cloudinary images (destroyed and purged from the CDN). Failures are logged, never
 * thrown. A photo copied to Cloudinary by the migration keeps its original local file as a backup.
 */
export async function removePhotos(photos: StoredPhoto[]): Promise<void> {
  await deletePhotos(photos.filter((p) => !isCloudinary(p) && p.file).map((p) => p.file!));
  await Promise.all(
    photos.filter(isCloudinary).map((p) =>
      destroyImage(p.publicId!).catch((err) => console.warn(`[photos] could not delete a Cloudinary image (${err instanceof Error ? err.message : 'error'})`)),
    ),
  );
}
