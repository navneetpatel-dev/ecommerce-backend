import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '@core/errors/AppError';
import { ERROR_CODES } from '@core/constants/errors';
import { BUG_ATTACHMENT_TYPE, TICKET_ATTACHMENT_TYPE } from '@core/constants/statuses';
import { assertAttachmentLimits } from '../limits';

describe('assertAttachmentLimits', () => {
  it('rejects unknown ticket video duration separately from too-long', () => {
    assert.throws(
      () =>
        assertAttachmentLimits(
          [{ url: 'https://example.com/a.mp4', type: TICKET_ATTACHMENT_TYPE.VIDEO, durationSeconds: null }],
          'ticket',
        ),
      (err: unknown) =>
        err instanceof AppError && err.code === ERROR_CODES.TICKET_VIDEO_DURATION_UNKNOWN,
    );
  });

  it('rejects ticket video over 60 seconds as too long', () => {
    assert.throws(
      () =>
        assertAttachmentLimits(
          [{ url: 'https://example.com/a.mp4', type: TICKET_ATTACHMENT_TYPE.VIDEO, durationSeconds: 61 }],
          'ticket',
        ),
      (err: unknown) =>
        err instanceof AppError && err.code === ERROR_CODES.TICKET_VIDEO_TOO_LONG,
    );
  });

  it('rejects unknown bug recording duration separately from too-long', () => {
    assert.throws(
      () =>
        assertAttachmentLimits(
          [
            {
              url: 'https://example.com/a.mp4',
              type: BUG_ATTACHMENT_TYPE.SCREEN_RECORDING,
              durationSeconds: undefined,
            },
          ],
          'bug',
        ),
      (err: unknown) =>
        err instanceof AppError && err.code === ERROR_CODES.BUG_VIDEO_DURATION_UNKNOWN,
    );
  });

  it('allows a valid ticket image + video under limits', () => {
    assert.doesNotThrow(() =>
      assertAttachmentLimits(
        [
          { url: 'https://example.com/a.jpg', type: TICKET_ATTACHMENT_TYPE.IMAGE },
          {
            url: 'https://example.com/a.mp4',
            type: TICKET_ATTACHMENT_TYPE.VIDEO,
            durationSeconds: 45,
          },
        ],
        'ticket',
      ),
    );
  });
});
