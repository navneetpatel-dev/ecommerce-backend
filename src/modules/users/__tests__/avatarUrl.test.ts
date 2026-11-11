import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { env } from '@config/env';
import { publicObjectUrl } from '@config/s3';
import { isOwnAvatarUrl } from '../avatarUrl';

const userId = '7f1d2c3b-0000-4000-8000-000000000001';
const own = publicObjectUrl(`${env.NODE_ENV}/users/${userId}/avatar/2b9f6a50-1111-4222-8333-444455556666.webp`);

describe('profile photo links (B-41)', () => {
  it('accepts this user’s own upload', () => {
    assert.equal(isOwnAvatarUrl(own, userId), true);
  });

  it('refuses scripts, other sites, plain http and other users’ files', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'https://evil.example.com/a.png',
      own.replace('https://', 'http://'),
      own.replace(userId, '7f1d2c3b-0000-4000-8000-000000000002'),
      own.replace('/avatar/', '/kyc/'),
      'https://other-bucket.s3.ap-south-1.amazonaws.com/' + own.split('.com/')[1],
      'not a url',
    ]) {
      assert.equal(isOwnAvatarUrl(url, userId), false, url);
    }
  });
});
