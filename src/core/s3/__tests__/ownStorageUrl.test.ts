import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { env } from '@config/env';
import { publicObjectUrl } from '@config/s3';
import { assertAttachmentsUploaded } from '../ownStorageUrl';
import { S3_ENTITY_TYPES, S3_PURPOSES } from '../constants';

const ticketFile = publicObjectUrl(`${env.NODE_ENV}/tickets/1b2c3d4e-0000-4000-8000-000000000001/attachments/9a8b7c6d-1111-4222-8333-444455556666.png`);

describe('ticket and bug-report attachments must be uploads', () => {
  it('accepts a file uploaded for tickets', () => {
    assert.doesNotThrow(() =>
      assertAttachmentsUploaded([{ url: ticketFile }], S3_ENTITY_TYPES.TICKETS, S3_PURPOSES.ATTACHMENTS),
    );
  });

  it('refuses other sites, script links and files from other folders', () => {
    for (const url of [
      'https://evil.example.com/a.png',
      'javascript:alert(1)',
      ticketFile.replace('/tickets/', '/users/').replace('/attachments/', '/avatar/'),
    ]) {
      assert.throws(
        () => assertAttachmentsUploaded([{ url: ticketFile }, { url }], S3_ENTITY_TYPES.TICKETS, S3_PURPOSES.ATTACHMENTS),
        (err: { statusCode?: number }) => err.statusCode === 422,
        url,
      );
    }
    assert.throws(() =>
      assertAttachmentsUploaded([{ url: ticketFile }], S3_ENTITY_TYPES.BUG_REPORTS, S3_PURPOSES.ATTACHMENTS),
    );
  });
});
