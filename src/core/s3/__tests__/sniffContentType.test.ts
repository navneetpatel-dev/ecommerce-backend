import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ValidationError } from '@core/errors/ValidationError';
import { assertContentMatchesType, sniffContentType } from '../sniffContentType';

const bytes = (...values: number[]) => Buffer.from(values);
const text = (value: string) => Buffer.from(value, 'latin1');

const SAMPLES: Record<string, Buffer> = {
  'image/jpeg': bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10),
  'image/png': bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00),
  'image/webp': Buffer.concat([text('RIFF'), bytes(0x24, 0, 0, 0), text('WEBPVP8 ')]),
  'application/pdf': text('%PDF-1.7\n'),
  'video/mp4': Buffer.concat([bytes(0, 0, 0, 0x20), text('ftypisom')]),
  'video/webm': bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86),
};

describe('sniffContentType', () => {
  it('recognises every accepted upload type from its leading bytes', () => {
    for (const [type, sample] of Object.entries(SAMPLES)) {
      assert.equal(sniffContentType(sample), type, type);
    }
  });

  it('recognises nothing in text, HTML or truncated input', () => {
    assert.equal(sniffContentType(text('<html><script>alert(1)</script>')), null);
    assert.equal(sniffContentType(text('hello')), null);
    assert.equal(sniffContentType(bytes(0xff, 0xd8)), null);
    assert.equal(sniffContentType(Buffer.alloc(0)), null);
  });
});

describe('assertContentMatchesType', () => {
  const rejects = (sample: Buffer, type: string) =>
    assert.throws(() => assertContentMatchesType(sample, type), ValidationError, type);

  it('accepts a file whose bytes are the declared type', () => {
    for (const [type, sample] of Object.entries(SAMPLES)) {
      assertContentMatchesType(sample, type);
      assertContentMatchesType(sample, `${type.toUpperCase()}; charset=binary`);
    }
  });

  it('rejects a script or page disguised as an image or document', () => {
    rejects(text('<svg onload="alert(1)"></svg>'), 'image/png');
    rejects(text('<!doctype html><p>hi</p>'), 'application/pdf');
    rejects(text('MZ\x90\x00'), 'image/jpeg');
  });

  it('rejects one accepted type labelled as another', () => {
    rejects(SAMPLES['image/png']!, 'image/jpeg');
    rejects(SAMPLES['application/pdf']!, 'image/webp');
    rejects(SAMPLES['video/webm']!, 'video/mp4');
  });

  it('leaves types with no known signature alone', () => {
    assertContentMatchesType(text('a,b\n1,2\n'), 'text/csv');
  });
});
