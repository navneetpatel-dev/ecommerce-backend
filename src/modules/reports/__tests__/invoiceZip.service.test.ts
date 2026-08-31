import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { zipBuffers } from '../invoiceZip.service';

describe('invoiceZip.service', () => {
  it('packs multiple PDF buffers into a zip archive', async () => {
    const zip = await zipBuffers([
      { name: 'a.pdf', buffer: Buffer.from('%PDF-a') },
      { name: 'b.pdf', buffer: Buffer.from('%PDF-b') },
    ]);
    assert.ok(zip.length > 40);
    // ZIP local file header magic
    assert.equal(zip.subarray(0, 2).toString('binary'), 'PK');
  });
});
