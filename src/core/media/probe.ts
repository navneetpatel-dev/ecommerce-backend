import { HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import {
  extractS3KeyFromUrl,
  isS3Configured,
  S3_BUCKET,
  s3Client,
} from '@config/s3';
import { deleteS3ObjectByUrl } from '@core/s3';
import {
  BUG_ATTACHMENT_TYPE,
  TICKET_ATTACHMENT_TYPE,
} from '@core/constants/statuses';
import {
  BUG_MAX_RECORDING_SECONDS,
  MAX_VIDEO_BYTES,
  TICKET_MAX_VIDEO_SECONDS,
  type BugAttachmentInput,
  type TicketAttachmentInput,
} from './limits';

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Parse duration (seconds) from an MP4/MOV `mvhd` box. Returns null if not found. */
export function parseMp4DurationSeconds(buffer: Buffer): number | null {
  const len = buffer.length;
  let offset = 0;
  while (offset + 8 <= len) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (size === 1 && offset + 16 <= len) {
      size = Number(buffer.readBigUInt64BE(offset + 8));
    }
    if (size < 8 || offset + size > len) break;

    if (type === 'moov' || type === 'trak' || type === 'mdia') {
      const nested = parseMp4DurationSeconds(buffer.subarray(offset + 8, offset + size));
      if (nested != null) return nested;
    }

    if (type === 'mvhd') {
      const version = buffer.readUInt8(offset + 8);
      if (version === 0 && offset + 32 <= len) {
        const timescale = buffer.readUInt32BE(offset + 20);
        const duration = buffer.readUInt32BE(offset + 24);
        if (timescale > 0) return duration / timescale;
      } else if (version === 1 && offset + 44 <= len) {
        const timescale = buffer.readUInt32BE(offset + 28);
        const duration = Number(buffer.readBigUInt64BE(offset + 32));
        if (timescale > 0) return duration / timescale;
      }
    }

    offset += size;
  }
  return null;
}

/** Reads an EBML "size" vint (marker bit stripped). Returns null on malformed input. */
function readEbmlSize(buffer: Buffer, offset: number): { value: number; length: number } | null {
  if (offset >= buffer.length) return null;
  const first = buffer[offset]!;
  if (first === 0) return null;
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || offset + length > buffer.length) return null;
  let value = first & (mask - 1);
  for (let i = 1; i < length; i++) {
    value = value * 256 + buffer[offset + i]!;
  }
  return { value, length };
}

function readUIntBE(buffer: Buffer, offset: number, length: number): number | null {
  if (length <= 0 || length > 6 || offset + length > buffer.length) return null;
  return buffer.readUIntBE(offset, length);
}

/**
 * Parse duration (seconds) from a WebM/Matroska file via its EBML `Segment > Info` element:
 * `TimecodeScale` (ID 0x2AD7B1, default 1,000,000ns) and `Duration` (ID 0x4489, float).
 * Uses a direct byte-pattern search rather than full EBML tree walking — sufficient for the
 * head/tail probe windows we download, and MediaRecorder output always keeps Info near the start.
 */
export function parseWebMDurationSeconds(buffer: Buffer): number | null {
  let timecodeScale = 1_000_000;
  const scaleIdx = buffer.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));
  if (scaleIdx !== -1) {
    const size = readEbmlSize(buffer, scaleIdx + 3);
    if (size) {
      const value = readUIntBE(buffer, scaleIdx + 3 + size.length, size.value);
      if (value != null && value > 0) timecodeScale = value;
    }
  }

  const durationIdx = buffer.indexOf(Buffer.from([0x44, 0x89]));
  if (durationIdx === -1) return null;
  const size = readEbmlSize(buffer, durationIdx + 2);
  if (!size) return null;
  const dataStart = durationIdx + 2 + size.length;
  if (dataStart + size.value > buffer.length) return null;

  let durationTicks: number | null = null;
  if (size.value === 4) {
    durationTicks = buffer.readFloatBE(dataStart);
  } else if (size.value === 8) {
    durationTicks = buffer.readDoubleBE(dataStart);
  }
  if (durationTicks == null || !Number.isFinite(durationTicks) || durationTicks <= 0) {
    return null;
  }
  return (durationTicks * timecodeScale) / 1_000_000_000;
}

async function headObjectSize(key: string): Promise<number | null> {
  if (!s3Client) return null;
  const head = await s3Client.send(
    new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  );
  return head.ContentLength ?? null;
}

async function downloadObjectBuffer(key: string, maxBytes: number): Promise<Buffer | null> {
  if (!s3Client) return null;
  const result = await s3Client.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
    }),
  );
  return streamToBuffer(result.Body);
}

/**
 * Server hard backstop for video/recording attachments:
 * - reject oversized S3 objects
 * - re-probe MP4 duration when possible; delete orphan object on failure
 */
export async function assertRemoteVideoBackstop(
  attachments: Array<TicketAttachmentInput | BugAttachmentInput>,
  kind: 'ticket' | 'bug',
): Promise<void> {
  const videoTypes =
    kind === 'ticket'
      ? new Set<string>([TICKET_ATTACHMENT_TYPE.VIDEO])
      : new Set<string>([BUG_ATTACHMENT_TYPE.SCREEN_RECORDING]);
  const maxSeconds = kind === 'ticket' ? TICKET_MAX_VIDEO_SECONDS : BUG_MAX_RECORDING_SECONDS;
  const tooLongCode =
    kind === 'ticket' ? ERROR_CODES.TICKET_VIDEO_TOO_LONG : ERROR_CODES.BUG_VIDEO_TOO_LONG;
  const tooLongMessage =
    kind === 'ticket' ? ERROR_MESSAGES.TICKET_VIDEO_TOO_LONG : ERROR_MESSAGES.BUG_VIDEO_TOO_LONG;
  const tooLargeCode =
    kind === 'ticket' ? ERROR_CODES.TICKET_VIDEO_TOO_LARGE : ERROR_CODES.BUG_VIDEO_TOO_LARGE;
  const tooLargeMessage =
    kind === 'ticket' ? ERROR_MESSAGES.TICKET_VIDEO_TOO_LARGE : ERROR_MESSAGES.BUG_VIDEO_TOO_LARGE;
  const unknownDurationCode =
    kind === 'ticket'
      ? ERROR_CODES.TICKET_VIDEO_DURATION_UNKNOWN
      : ERROR_CODES.BUG_VIDEO_DURATION_UNKNOWN;
  const unknownDurationMessage =
    kind === 'ticket'
      ? ERROR_MESSAGES.TICKET_VIDEO_DURATION_UNKNOWN
      : ERROR_MESSAGES.BUG_VIDEO_DURATION_UNKNOWN;

  // Without S3 we cannot probe bytes, but declared duration remains a hard backstop.
  if (!isS3Configured()) {
    for (const attachment of attachments) {
      if (!videoTypes.has(attachment.type)) continue;
      if (
        attachment.durationSeconds == null ||
        !Number.isFinite(attachment.durationSeconds) ||
        attachment.durationSeconds <= 0
      ) {
        throw new AppError(unknownDurationMessage, 422, unknownDurationCode);
      }
      if (attachment.durationSeconds > maxSeconds) {
        throw new AppError(tooLongMessage, 422, tooLongCode);
      }
    }
    return;
  }

  for (const attachment of attachments) {
    if (!videoTypes.has(attachment.type)) continue;
    const key = extractS3KeyFromUrl(attachment.url);
    if (!key) continue;

    try {
      const size = await headObjectSize(key);
      if (size != null && size > MAX_VIDEO_BYTES) {
        await deleteS3ObjectByUrl(attachment.url);
        throw new AppError(tooLargeMessage, 422, tooLargeCode);
      }

      // Probe up to 8MB — enough for most moov/Info-at-start files; also try end via second range if needed.
      const headBuf = await downloadObjectBuffer(key, 8 * 1024 * 1024);
      let duration = headBuf
        ? (parseMp4DurationSeconds(headBuf) ?? parseWebMDurationSeconds(headBuf))
        : null;

      if (duration == null && size != null && size > 8 * 1024 * 1024 && s3Client) {
        const tailStart = Math.max(0, size - 2 * 1024 * 1024);
        const tail = await s3Client.send(
          new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
            Range: `bytes=${tailStart}-${size - 1}`,
          }),
        );
        const tailBuf = await streamToBuffer(tail.Body);
        duration = parseMp4DurationSeconds(tailBuf) ?? parseWebMDurationSeconds(tailBuf);
      }

      // Probe failed (e.g. streamed WebM with no Duration element, or unsupported container) —
      // fall back to the client-declared duration rather than silently accepting an unbounded file.
      if (duration == null) {
        if (attachment.durationSeconds == null) {
          await deleteS3ObjectByUrl(attachment.url);
          throw new AppError(unknownDurationMessage, 422, unknownDurationCode);
        }
        duration = attachment.durationSeconds;
      }

      if (duration > maxSeconds) {
        await deleteS3ObjectByUrl(attachment.url);
        throw new AppError(tooLongMessage, 422, tooLongCode);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      // S3 probe failed (permissions/network) — enforce client-declared duration as backstop.
      if (attachment.durationSeconds == null) {
        await deleteS3ObjectByUrl(attachment.url);
        throw new AppError(unknownDurationMessage, 422, unknownDurationCode);
      }
      if (attachment.durationSeconds > maxSeconds) {
        await deleteS3ObjectByUrl(attachment.url);
        throw new AppError(tooLongMessage, 422, tooLongCode);
      }
    }
  }
}
