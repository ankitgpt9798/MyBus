import { exifOrientation } from './upload.service';

export type ImageType = 'jpg' | 'png' | 'webp';

/**
 * Display size of a JPEG / PNG / WebP image read from its header (no decoding). JPEG sizes follow the Exif
 * orientation, so a portrait phone photo reports portrait dimensions. Returns null when the header is unreadable.
 */
export function imageSize(buf: Buffer, type: ImageType): { width: number; height: number } | null {
  try {
    if (type === 'png') return buf.length >= 24 ? ok(buf.readUInt32BE(16), buf.readUInt32BE(20)) : null;
    if (type === 'webp') return webpSize(buf);
    return jpegSize(buf);
  } catch {
    return null;
  }
}

const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);

function jpegSize(buf: Buffer) {
  let orientation: number | null = null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && orientation === null) orientation = exifOrientation(buf.subarray(i, i + 2 + len));
    // Start-of-frame markers (not DHT C4, JPG C8 or DAC CC) hold the frame height and width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return orientation && orientation >= 5 ? ok(height, width) : ok(width, height);
    }
    if (marker === 0xda) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(buf: Buffer) {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return ok(1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3));
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ') return ok(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
  return null;
}
