import type { ReviewMediaItem } from '@database/models/review.model';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { S3_ENTITY_TYPES, S3_PURPOSES, parseS3Key } from '@core/s3';
import { extractS3KeyFromUrl } from '@config/s3';
import { assertAttachmentLimits, assertRemoteVideoBackstop } from '@core/media';
import { draftOwner } from '@modules/uploads/uploadAuthorization';
import type { CreateReviewRequest } from './reviews.dto';

function mediaInvalid(): AppError {
  return new AppError(ERROR_MESSAGES.REVIEW_MEDIA_INVALID, 422, ERROR_CODES.REVIEW_MEDIA_INVALID);
}

/**
 * The photos and video a reviewer attached. They were uploaded before the review existed,
 * under `reviews/{draftId}/attachments/` — the id the review then takes — so each one must
 * be this reviewer's upload under that draft: nothing from another path, user or review.
 * Same limits as a support ticket: 5 images, 1 video of at most 60 seconds.
 */
export async function resolveReviewMedia(
  userId: string,
  draftId: string | undefined,
  attachments: CreateReviewRequest['attachments'],
): Promise<ReviewMediaItem[]> {
  if (!attachments?.length) return [];
  if (!draftId || (await draftOwner(S3_ENTITY_TYPES.REVIEWS, draftId)) !== userId) throw mediaInvalid();

  for (const attachment of attachments) {
    const key = extractS3KeyFromUrl(attachment.url);
    const parsed = key ? parseS3Key(key) : null;
    if (
      !parsed ||
      parsed.entityType !== S3_ENTITY_TYPES.REVIEWS ||
      parsed.entityId !== draftId ||
      parsed.purpose !== S3_PURPOSES.ATTACHMENTS
    ) {
      throw mediaInvalid();
    }
  }

  assertAttachmentLimits(attachments, 'ticket');
  await assertRemoteVideoBackstop(attachments, 'ticket', S3_ENTITY_TYPES.REVIEWS);
  return attachments.map((attachment) => ({
    url: attachment.url,
    type: attachment.type,
    durationSeconds: attachment.durationSeconds ?? null,
  }));
}

/**
 * Media on an edited review. Anything it already had stays as posted; anything new
 * must be the author's upload under the review's own id (uploads are authorized to
 * the review's author only once it exists). Same limits as posting.
 */
export async function resolveEditedReviewMedia(
  review: { id: string; media: ReviewMediaItem[] | null },
  attachments: NonNullable<CreateReviewRequest['attachments']>,
): Promise<ReviewMediaItem[]> {
  const current = new Map((review.media ?? []).map((item) => [item.url, item]));
  const next: ReviewMediaItem[] = [];
  for (const attachment of attachments) {
    const kept = current.get(attachment.url);
    if (kept) {
      next.push(kept);
      continue;
    }
    const key = extractS3KeyFromUrl(attachment.url);
    const parsed = key ? parseS3Key(key) : null;
    if (
      !parsed ||
      parsed.entityType !== S3_ENTITY_TYPES.REVIEWS ||
      parsed.entityId !== review.id ||
      parsed.purpose !== S3_PURPOSES.ATTACHMENTS
    ) {
      throw mediaInvalid();
    }
    next.push({ url: attachment.url, type: attachment.type, durationSeconds: attachment.durationSeconds ?? null });
  }
  assertAttachmentLimits(next, 'ticket');
  await assertRemoteVideoBackstop(
    next.filter((item) => !current.has(item.url)),
    'ticket',
    S3_ENTITY_TYPES.REVIEWS,
  );
  return next;
}
