import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveEditedReviewMedia } from '../reviewMedia';

const review = {
  id: '8bdf2ea7-6f4f-4b1b-9d7a-0f0f5b1a2c3d',
  media: [{ url: 'https://cdn.example/legacy-photo.jpg', type: 'IMAGE' as const, durationSeconds: null }],
};

describe('editing a review\'s photos', () => {
  it('keeps photos it already had exactly as posted', async () => {
    const next = await resolveEditedReviewMedia(review, [{ url: review.media[0]!.url, type: 'IMAGE' }]);
    assert.deepEqual(next, review.media);
  });

  it('allows removing every photo', async () => {
    assert.deepEqual(await resolveEditedReviewMedia(review, []), []);
  });

  it('refuses a new photo that was not uploaded for this review', async () => {
    await assert.rejects(
      resolveEditedReviewMedia(review, [{ url: 'https://evil.example/x.jpg', type: 'IMAGE' }]),
      (err: { message?: string }) => /uploaded for this review/.test(String(err.message)),
    );
  });
});
