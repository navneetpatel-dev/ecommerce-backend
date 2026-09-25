/**
 * POST /uploads/verify: a direct-to-S3 upload is checked after the client's PUT.
 * The presigned URL pins Content-Type and size, not the bytes, so a disguised file
 * is caught here and deleted. S3 is mocked; the checks themselves are real.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { buildS3Key, S3_ENTITY_TYPES, S3_PURPOSES } from '@core/s3';
import { uploadsService, type UploadVerifyStorage } from '../uploads.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>', 'latin1');

function customer() {
  return {
    id: randomUUID(),
    vendorId: null,
    deliveryAgentId: null,
    role: { name: 'CUSTOMER' },
    roleId: 'role-customer',
  };
}

function fakeStorage(object: { contentType: string; bytes: Buffer } | null) {
  const remove = mock.fn(async (_key: string) => undefined);
  const storage: UploadVerifyStorage = {
    isConfigured: () => true,
    readHead: async () => object,
    remove,
  };
  return { storage, remove };
}

describe('uploadsService.verifyUpload', () => {
  afterEach(() => mock.restoreAll());

  it('keeps an upload whose bytes are the declared type', async () => {
    const actor = customer();
    const key = buildS3Key(S3_ENTITY_TYPES.USERS, actor.id, S3_PURPOSES.AVATAR, 'me.png');
    const { storage, remove } = fakeStorage({ contentType: 'image/png', bytes: PNG });

    assert.deepEqual(await uploadsService.verifyUpload(actor, { key }, storage), { key });
    assert.equal(remove.mock.callCount(), 0);
  });

  it('deletes a page disguised as an image and rejects it', async () => {
    const actor = customer();
    const key = buildS3Key(S3_ENTITY_TYPES.USERS, actor.id, S3_PURPOSES.AVATAR, 'me.png');
    const { storage, remove } = fakeStorage({ contentType: 'image/png', bytes: HTML });

    await assert.rejects(uploadsService.verifyUpload(actor, { key }, storage), ValidationError);
    assert.deepEqual(remove.mock.calls[0]?.arguments, [key]);
  });

  it('deletes an object stored with a type the purpose does not allow', async () => {
    const actor = customer();
    const key = buildS3Key(S3_ENTITY_TYPES.USERS, actor.id, S3_PURPOSES.AVATAR, 'me.png');
    const { storage, remove } = fakeStorage({ contentType: 'text/html', bytes: HTML });

    await assert.rejects(uploadsService.verifyUpload(actor, { key }, storage), ValidationError);
    assert.equal(remove.mock.callCount(), 1);
  });

  it("refuses to check (or delete) someone else's upload", async () => {
    const key = buildS3Key(S3_ENTITY_TYPES.USERS, randomUUID(), S3_PURPOSES.AVATAR, 'x.png');
    const { storage, remove } = fakeStorage({ contentType: 'image/png', bytes: HTML });

    await assert.rejects(uploadsService.verifyUpload(customer(), { key }, storage), ForbiddenError);
    assert.equal(remove.mock.callCount(), 0);
  });

  it('rejects keys this server did not issue', async () => {
    const { storage } = fakeStorage(null);
    await assert.rejects(
      uploadsService.verifyUpload(customer(), { key: 'production/users/../../etc/passwd' }, storage),
      ValidationError,
    );
  });
});
