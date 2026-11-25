import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export const MAX_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const COMMUNITY_DIR = path.join(env.uploadsDir, 'community');

type ImageType = 'jpg' | 'png' | 'webp';

/** Real file type from the first bytes (the file name and declared MIME type are not trusted). */
export function sniffImage(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Removes camera / GPS metadata without re-encoding the image:
 *  - JPEG: APP1 (Exif, XMP), APP13 (IPTC) and comment segments
 *  - PNG:  eXIf and text (tEXt / zTXt / iTXt) and tIME chunks
 *  - WebP: EXIF and XMP chunks (and their flags in VP8X)
 * Pixel data and colour profiles are kept. On anything unexpected the original is returned unchanged.
 */
export function stripMetadata(buf: Buffer, type: ImageType): Buffer {
  try {
    if (type === 'jpg') return stripJpeg(buf);
    if (type === 'png') return stripPng(buf);
    return stripWebp(buf);
  } catch {
    return buf;
  }
}

function stripJpeg(buf: Buffer): Buffer {
  const parts: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf; // not a marker: leave the file alone
    const marker = buf[i + 1];
    if (marker === 0xda) {
      parts.push(buf.subarray(i)); // start of scan: the rest is image data
      return Buffer.concat(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const segment = buf.subarray(i, i + 2 + len);
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) parts.push(segment);
    i += 2 + len;
  }
  return buf;
}

function stripPng(buf: Buffer): Buffer {
  const drop = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
  const parts: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const chunk = buf.subarray(i, i + 12 + len);
    if (!drop.has(type)) parts.push(chunk);
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

function stripWebp(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    const total = 8 + size + (size % 2);
    let chunk = Buffer.from(buf.subarray(i, i + total));
    if (fourcc === 'VP8X') chunk[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') parts.push(chunk);
    i += total;
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/** multer: keep files in memory so they can be checked before anything is written to disk. */
const memory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: MAX_PHOTOS, fields: 20, fieldSize: 64 * 1024 },
});

/** Parses a multipart form with up to MAX_PHOTOS "photos" files; multer errors become translated API errors. */
export function photoUpload(req: Request, res: Response, next: NextFunction) {
  memory.array('photos', MAX_PHOTOS)(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'COMMUNITY_PHOTO_TOO_LARGE', 'Each photo can be at most 5 MB', [{ field: 'photos', rule: 'size', params: { max: 5 } }]));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new AppError(400, 'COMMUNITY_TOO_MANY_PHOTOS', 'At most 4 photos per post', [{ field: 'photos', rule: 'maxItems', params: { max: MAX_PHOTOS } }]));
      }
      return next(new AppError(400, 'VALIDATION_ERROR', err.message));
    }
    next(err);
  });
}

export interface StoredPhoto {
  file: string;
  type: ImageType;
  size: number;
}

/** Checks the real type of each uploaded file; throws COMMUNITY_PHOTO_TYPE for anything that is not JPEG/PNG/WebP. */
export function checkPhotos(files: Express.Multer.File[]): ImageType[] {
  return files.map((f, index) => {
    const type = sniffImage(f.buffer);
    if (!type) throw new AppError(400, 'COMMUNITY_PHOTO_TYPE', 'Photos must be JPEG, PNG or WebP images', [{ field: 'photos', rule: 'type', params: { index } }]);
    return type;
  });
}

/** Writes checked photos (metadata stripped) under random names. */
export async function savePhotos(files: Express.Multer.File[], types: ImageType[]): Promise<StoredPhoto[]> {
  await fs.mkdir(COMMUNITY_DIR, { recursive: true });
  const saved: StoredPhoto[] = [];
  try {
    for (const [i, f] of files.entries()) {
      const data = stripMetadata(f.buffer, types[i]);
      const file = `${crypto.randomBytes(16).toString('hex')}.${types[i]}`;
      await fs.writeFile(path.join(COMMUNITY_DIR, file), data, { flag: 'wx' });
      saved.push({ file, type: types[i], size: data.length });
    }
    return saved;
  } catch (err) {
    await deletePhotos(saved.map((s) => s.file));
    throw err;
  }
}

/** Removes stored photos (missing files are ignored). Only plain generated names are accepted. */
export async function deletePhotos(files: string[]): Promise<void> {
  await Promise.all(
    files
      .filter((f) => /^[\w-]+\.(jpg|png|webp)$/.test(f))
      .map((f) => fs.rm(path.join(COMMUNITY_DIR, f), { force: true }).catch(() => undefined)),
  );
}

export const photoUrl = (file: string) => `/uploads/community/${file}`;
