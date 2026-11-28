import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sequelize } from '@database/models';
import { interpolateBroadcastText, previewBroadcastTargetsQuery, resolveBroadcastBatch } from '../broadcastTargeting.service';
import type { BroadcastTargetConfig } from '../broadcastTargeting.types';
import { BroadcastNotificationSchema } from '../notifications.dto';

describe('broadcastTargeting & DTO', () => {
  it('interpolates personalization tokens cleanly', () => {
    const out = interpolateBroadcastText(
      'Hi {{firstName}} ({{role}}) at {{businessName}} in {{city}}',
      {
        id: 'u1',
        email: 'a@b.com',
        name: 'Aarav Patel',
        role: 'VENDOR_OWNER',
        businessName: 'Apex Store',
        city: 'Surat',
        emailVerified: true,
        emailMarketingConsent: true,
        emailSuppressed: false,
        hasPush: false,
      },
    );
    assert.equal(out, 'Hi Aarav (VENDOR_OWNER) at Apex Store in Surat');
  });

  it('validates multi-role, segment, channels, and scheduledAt in BroadcastNotificationSchema', () => {
    const valid = BroadcastNotificationSchema.safeParse({
      mode: 'vendor_segment',
      vendorSegment: { vendorStatus: 'APPROVED', kycVerified: true },
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
      classification: 'operational',
      priority: 'high',
      subject: 'KYC Update',
      message: 'Please review the new guidelines.',
      ctaLabel: 'Open Portal',
      ctaUrl: 'https://example.com/vendor',
      scheduledAt: '2026-12-01T10:00:00.000Z',
    });
    assert.equal(valid.success, true);
  });

  it('rejects empty targeting when no mode/role/users is specified', () => {
    const invalid = BroadcastNotificationSchema.safeParse({
      subject: 'Hello',
      message: 'Body',
    });
    assert.equal(invalid.success, false);
  });
});

describe('a targeting that names nobody', () => {
  const nobody: BroadcastTargetConfig[] = [
    {},
    { mode: 'users' },
    { mode: 'users', userIds: [], emails: [] },
    { mode: 'roles', allUsers: false, roles: [] },
    { mode: 'roles', excludeRoles: ['VENDOR_OWNER'] },
  ];

  it('previews and sends to no one instead of every account', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    for (const config of nobody) {
      const preview = await previewBroadcastTargetsQuery(config);
      assert.equal(preview.total, 0, JSON.stringify(config));
      assert.deepEqual(preview.sampleRecipients, []);
      assert.deepEqual(await resolveBroadcastBatch(config), [], JSON.stringify(config));
    }
  });

  it('still reaches the people a targeting does name', async (t) => {
    try {
      await sequelize.authenticate();
    } catch {
      return t.skip('database unavailable');
    }
    const everyone = await previewBroadcastTargetsQuery({ mode: 'roles', allUsers: true });
    if (everyone.total === 0) return t.skip('no accounts in this database');
    const [first] = everyone.sampleRecipients;
    const one = await previewBroadcastTargetsQuery({ mode: 'users', userIds: [first!.id] });
    assert.equal(one.total, 1);
  });

  it('is refused when sending', () => {
    for (const config of nobody) {
      const parsed = BroadcastNotificationSchema.safeParse({ ...config, subject: 'Hello', message: 'Body' });
      assert.equal(parsed.success, false, JSON.stringify(config));
    }
  });
});
