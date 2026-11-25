import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { interpolateBroadcastText } from '../broadcastTargeting.service';
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
