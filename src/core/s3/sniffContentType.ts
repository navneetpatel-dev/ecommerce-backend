import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';

/** Bytes needed to recognise every type below (WebP reads 12, MP4 `ftyp` reads 8). */
export const SNIFF_BYTES = 16;

function startsWith(bytes: Buffer, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Buffer, start: number, end: number): string {
  return bytes.length >= end ? bytes.toString('latin1', start, end) : '';
}

/**
 * The media type a file's leading bytes ("magic bytes") identify, for the types
 * uploads accept: JPEG, PNG, WebP, PDF, MP4 and WebM. Null when the bytes match
 * none of them. The client's declared Content-Type is trivially spoofable; this is not.
 */
export function sniffContentType(bytes: Buffer): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(bytes, 4, 8) === 'ftyp') return 'video/mp4';
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  return null;
}

/** Declared types this module can verify; anything else has no signature to check. */
const SNIFFABLE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
]);

/**
 * Throws when a file's bytes are not the type it was declared as — for example an
 * HTML page or script uploaded as `image/png`. Types with no known signature pass.
 */
export function assertContentMatchesType(bytes: Buffer, declaredContentType: string): void {
  const declared = declaredContentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!SNIFFABLE_TYPES.has(declared)) return;
  if (sniffContentType(bytes) !== declared) {
    throw new ValidationError({ file: [ERROR_MESSAGES.UPLOAD_CONTENT_MISMATCH] });
  }
}
