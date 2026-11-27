/**
 * Copies community photos kept in the local uploads folder to Cloudinary and points those photo entries at the copies.
 *
 *   npm run migrate:photos -- --dry-run   counts only, nothing is uploaded or changed
 *   npm run migrate:photos                copy and update
 *
 * - Only photo entries that are not on Cloudinary yet are changed (photos saved before Cloudinary support count as local).
 * - Safe to re-run: photos already on Cloudinary are skipped, and each image's Cloudinary id comes from its file name,
 *   so an upload repeated after an interrupted run reuses the image instead of making a copy.
 * - Never deletes the local files (they stay as a backup) and never changes or deletes anything else in the database.
 * - Uses MONGODB_URI, UPLOADS_DIR and the CLOUDINARY_* settings from the environment or backend/.env.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { Post } from '../models/Post';
import { CloudinaryError, uploadImage } from '../services/cloudinary.service';
import { imageSize } from '../services/image-info';
import { COMMUNITY_DIR, sniffImage, stripMetadata } from '../services/upload.service';

const dryRun = process.argv.includes('--dry-run');
const NOT_ON_CLOUDINARY = { storage: { $ne: 'cloudinary' } };
const FILE_NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

async function main(): Promise<number> {
  const cfg = env.photos.cloudinary;
  if (!dryRun && !(cfg.cloudName && cfg.apiKey && cfg.apiSecret)) {
    console.error('[migrate] set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET first');
    return 1;
  }
  await connectDb();
  console.log(dryRun ? '[migrate] dry run: nothing is uploaded or changed' : `[migrate] copying local photos to the Cloudinary folder "${cfg.folder}"`);

  const posts = await Post.find({ photos: { $elemMatch: NOT_ON_CLOUDINARY } }).select('photos').lean();
  const onCloudinary = await Post.aggregate<{ n: number }>([{ $unwind: '$photos' }, { $match: { 'photos.storage': 'cloudinary' } }, { $count: 'n' }]);
  const counts = { found: 0, uploaded: 0, skipped: onCloudinary[0]?.n ?? 0, failed: 0, missingFiles: 0 };
  const warn = (msg: string) => !dryRun && console.warn(`[migrate] ${msg}`);

  for (const post of posts) {
    for (const ph of post.photos) {
      if (ph.storage === 'cloudinary') continue;
      counts.found++;
      const file = ph.file ?? '';
      if (!FILE_NAME.test(file)) {
        counts.failed++;
        warn(`post ${post._id}: photo without a valid file name`);
        continue;
      }
      let data: Buffer;
      try {
        data = await fs.readFile(path.join(COMMUNITY_DIR, file));
      } catch {
        counts.failed++;
        counts.missingFiles++;
        warn(`post ${post._id}: ${file} is not in the uploads folder`);
        continue;
      }
      const type = sniffImage(data);
      if (!type) {
        counts.failed++;
        warn(`post ${post._id}: ${file} is not a JPEG, PNG or WebP image`);
        continue;
      }
      if (dryRun) continue;
      try {
        const clean = stripMetadata(data, type);
        const up = await uploadImage(clean, { id: file.replace(/\.\w+$/, ''), ext: type, tags: ['mybus', 'mybus-migrated'] });
        const size = imageSize(clean, type);
        const width = up.width ?? size?.width;
        const height = up.height ?? size?.height;
        const set: Record<string, unknown> = {
          'photos.$.storage': 'cloudinary',
          'photos.$.url': up.url,
          'photos.$.publicId': up.publicId,
          'photos.$.format': type,
          'photos.$.bytes': up.bytes ?? clean.length,
          ...(width && height && { 'photos.$.width': width, 'photos.$.height': height }),
        };
        // Only this photo entry changes (not even updatedAt); the file name stays so the local copy remains findable.
        const res = await Post.updateOne({ _id: post._id, photos: { $elemMatch: { file, ...NOT_ON_CLOUDINARY } } }, { $set: set }, { timestamps: false });
        if (res.modifiedCount) counts.uploaded++;
        else counts.skipped++;
      } catch (err) {
        counts.failed++;
        warn(`post ${post._id}: ${file} failed (${err instanceof CloudinaryError ? `${err.status ? `HTTP ${err.status}: ` : ''}${err.message}` : 'database error'})`);
      }
    }
  }

  if (dryRun) {
    console.log(`[migrate] local photos found: ${counts.found} (in ${posts.length} posts), files present: ${counts.found - counts.failed}, files missing or invalid: ${counts.failed}`);
    console.log(`[migrate] already on Cloudinary (would be skipped): ${counts.skipped}`);
  } else {
    console.log(`[migrate] found: ${counts.found}, uploaded: ${counts.uploaded}, skipped: ${counts.skipped}, failed: ${counts.failed}${counts.missingFiles ? ` (${counts.missingFiles} missing files)` : ''}`);
    console.log('[migrate] local files were not deleted');
  }
  return !dryRun && counts.failed ? 1 : 0;
}

main()
  .then(async (code) => {
    await disconnectDb();
    process.exit(code);
  })
  .catch(async (err) => {
    // Never print a connection string (it can hold credentials).
    const message = (err instanceof Error ? err.message : 'unknown error').replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://…');
    console.error(`[migrate] stopped: ${message}`);
    await disconnectDb().catch(() => undefined);
    process.exit(1);
  });
