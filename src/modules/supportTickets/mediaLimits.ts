import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import {
  BUG_ATTACHMENT_TYPE,
  TICKET_ATTACHMENT_TYPE,
  type BugAttachmentType,
  type TicketAttachmentType,
} from '@core/constants/statuses';

export const TICKET_MAX_IMAGES = 5;
export const TICKET_MAX_VIDEOS = 1;
export const TICKET_MAX_VIDEO_SECONDS = 60;

export const BUG_MAX_SCREENSHOTS = 5;
export const BUG_MAX_RECORDINGS = 1;
export const BUG_MAX_RECORDING_SECONDS = 120;

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type TicketAttachmentInput = {
  url: string;
  type: TicketAttachmentType;
  durationSeconds?: number | null;
};

export type BugAttachmentInput = {
  url: string;
  type: BugAttachmentType;
  durationSeconds?: number | null;
};

export function assertAttachmentLimits(
  attachments: Array<TicketAttachmentInput | BugAttachmentInput>,
  kind: 'ticket' | 'bug',
): void {
  if (kind === 'ticket') {
    const images = attachments.filter((a) => a.type === TICKET_ATTACHMENT_TYPE.IMAGE);
    const videos = attachments.filter((a) => a.type === TICKET_ATTACHMENT_TYPE.VIDEO);
    if (images.length > TICKET_MAX_IMAGES || videos.length > TICKET_MAX_VIDEOS) {
      throw new AppError(
        ERROR_MESSAGES.TICKET_ATTACHMENT_LIMIT,
        422,
        ERROR_CODES.TICKET_ATTACHMENT_LIMIT,
      );
    }
    for (const video of videos) {
      if (
        video.durationSeconds == null ||
        !Number.isFinite(video.durationSeconds) ||
        video.durationSeconds <= 0 ||
        video.durationSeconds > TICKET_MAX_VIDEO_SECONDS
      ) {
        throw new AppError(
          ERROR_MESSAGES.TICKET_VIDEO_TOO_LONG,
          422,
          ERROR_CODES.TICKET_VIDEO_TOO_LONG,
        );
      }
    }
    return;
  }

  const screenshots = attachments.filter((a) => a.type === BUG_ATTACHMENT_TYPE.SCREENSHOT);
  const recordings = attachments.filter((a) => a.type === BUG_ATTACHMENT_TYPE.SCREEN_RECORDING);
  if (screenshots.length > BUG_MAX_SCREENSHOTS || recordings.length > BUG_MAX_RECORDINGS) {
    throw new AppError(ERROR_MESSAGES.BUG_ATTACHMENT_LIMIT, 422, ERROR_CODES.BUG_ATTACHMENT_LIMIT);
  }
  for (const recording of recordings) {
    if (
      recording.durationSeconds == null ||
      !Number.isFinite(recording.durationSeconds) ||
      recording.durationSeconds <= 0 ||
      recording.durationSeconds > BUG_MAX_RECORDING_SECONDS
    ) {
      throw new AppError(ERROR_MESSAGES.BUG_VIDEO_TOO_LONG, 422, ERROR_CODES.BUG_VIDEO_TOO_LONG);
    }
  }
}

/** Enforce cumulative limits when adding attachments to an existing ticket/bug. */
export function assertCombinedAttachmentLimits(
  existing: Array<{ type: string; durationSeconds?: number | null }>,
  incoming: Array<TicketAttachmentInput | BugAttachmentInput>,
  kind: 'ticket' | 'bug',
): void {
  assertAttachmentLimits([...existing, ...incoming] as Array<TicketAttachmentInput | BugAttachmentInput>, kind);
}
