import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { env } from '@config/env';
import { publicObjectUrl } from '@config/s3';
import { sequelize } from '@database/models';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES } from '@core/constants/errors';
import { resolveReviewMedia } from '../reviewMedia';

const DRAFT = '0b8f8e3e-3c55-4b52-9d65-1f3c2a6b7d10';
const OTHER = '6d1b7c39-1d2a-4c0e-8f7a-2b9e5d4c3a21';
// Built the way the app builds them: on this store's own bucket.
const url = (entityId: string, file: string, entity = 'reviews') =>
  publicObjectUrl(`${env.NODE_ENV}/${entity}/${entityId}/attachments/${file}`);

function draftOwnedBy(userId: string | null) {
  mock.method(sequelize, 'query', async () => (userId ? [{ userId }] : []) as never);
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  const err = await promise.then(() => undefined, (e: unknown) => e);
  return err instanceof AppError ? err.code : undefined;
}

describe('resolveReviewMedia', () => {
  afterEach(() => mock.restoreAll());

  it('keeps photos and a video uploaded under the reviewer’s own draft', async () => {
    draftOwnedBy('u-1');
    const media = await resolveReviewMedia('u-1', DRAFT, [
      { url: url(DRAFT, '11111111-1111-4111-8111-111111111111.jpg'), type: 'IMAGE' },
      { url: url(DRAFT, '22222222-2222-4222-8222-222222222222.mp4'), type: 'VIDEO', durationSeconds: 42 },
    ]);
    assert.deepEqual(
      media.map((item) => [item.type, item.durationSeconds]),
      [
        ['IMAGE', null],
        ['VIDEO', 42],
      ],
    );
  });

  it('is empty without attachments, draft or not', async () => {
    assert.deepEqual(await resolveReviewMedia('u-1', undefined, []), []);
  });

  it('refuses media from someone else’s draft, another review or another entity', async () => {
    draftOwnedBy('u-2');
    assert.equal(
      await code(resolveReviewMedia('u-1', DRAFT, [{ url: url(DRAFT, '11111111-1111-4111-8111-111111111111.jpg'), type: 'IMAGE' }])),
      ERROR_CODES.REVIEW_MEDIA_INVALID,
    );
    mock.restoreAll();
    draftOwnedBy('u-1');
    assert.equal(
      await code(resolveReviewMedia('u-1', DRAFT, [{ url: url(OTHER, '11111111-1111-4111-8111-111111111111.jpg'), type: 'IMAGE' }])),
      ERROR_CODES.REVIEW_MEDIA_INVALID,
    );
    assert.equal(
      await code(
        resolveReviewMedia('u-1', DRAFT, [{ url: url(DRAFT, '11111111-1111-4111-8111-111111111111.jpg', 'tickets'), type: 'IMAGE' }]),
      ),
      ERROR_CODES.REVIEW_MEDIA_INVALID,
    );
    assert.equal(
      await code(resolveReviewMedia('u-1', DRAFT, [{ url: 'https://elsewhere.example/cat.jpg', type: 'IMAGE' }])),
      ERROR_CODES.REVIEW_MEDIA_INVALID,
    );
    assert.equal(
      await code(resolveReviewMedia('u-1', undefined, [{ url: url(DRAFT, '11111111-1111-4111-8111-111111111111.jpg'), type: 'IMAGE' }])),
      ERROR_CODES.REVIEW_MEDIA_INVALID,
    );
  });

  it('holds reviews to 5 photos and 1 video of at most 60 seconds', async () => {
    draftOwnedBy('u-1');
    const photo = (n: number) => ({ url: url(DRAFT, `1111111${n}-1111-4111-8111-111111111111.jpg`), type: 'IMAGE' as const });
    assert.equal(await code(resolveReviewMedia('u-1', DRAFT, [1, 2, 3, 4, 5, 6].map(photo))), ERROR_CODES.TICKET_ATTACHMENT_LIMIT);
    const video = (seconds: number) => ({
      url: url(DRAFT, '22222222-2222-4222-8222-222222222222.mp4'),
      type: 'VIDEO' as const,
      durationSeconds: seconds,
    });
    assert.equal(await code(resolveReviewMedia('u-1', DRAFT, [video(30), video(30)])), ERROR_CODES.TICKET_ATTACHMENT_LIMIT);
    assert.equal(await code(resolveReviewMedia('u-1', DRAFT, [video(61)])), ERROR_CODES.TICKET_VIDEO_TOO_LONG);
  });
});
