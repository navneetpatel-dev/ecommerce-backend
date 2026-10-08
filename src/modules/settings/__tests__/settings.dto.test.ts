import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UpdateSettingsSchema } from '../settings.dto';

const BASE = {
  defaultCommissionRate: 10,
  autoApproveProducts: false,
  defaultReturnWindow: 7,
  payoutCycle: 'WEEKLY',
  freeShippingThreshold: 499,
  supportEmail: 'support@example.com',
  supportHours: '9am–6pm IST',
  ticketReopenWindowDays: 7,
  bugVerifyWindowDays: 7,
  bugCloseWindowDays: 30,
};

describe('settings DTO schema', () => {
  it('accepts a complete payload and applies documented defaults for omitted fields', () => {
    const parsed = UpdateSettingsSchema.parse(BASE);
    assert.equal(parsed.tdsRatePercent, 0.1);
    assert.equal(parsed.tcsRatePercent, 0.5);
    assert.equal(parsed.commissionGstRatePercent, 18);
    assert.equal(parsed.codEnabled, true);
    assert.equal(parsed.walletMaxRechargeInr, 10000);
    assert.deepEqual(parsed.walletRechargePresetsInr, [500, 1000, 2000, 5000]);
    assert.equal(parsed.scheduledReportsDayOfWeek, 1);
    assert.equal(parsed.scheduledReportsEnabled, false);
  });

  it('bounds the percentage fields to 0–100', () => {
    assert.equal(
      UpdateSettingsSchema.safeParse({ ...BASE, defaultCommissionRate: 101 }).success,
      false,
    );
    assert.equal(
      UpdateSettingsSchema.safeParse({ ...BASE, defaultCommissionRate: -1 }).success,
      false,
    );
    assert.equal(
      UpdateSettingsSchema.safeParse({ ...BASE, tcsRatePercent: 50.5 }).success,
      true,
    );
  });

  it('bounds the support-ticket and bug windows', () => {
    assert.equal(
      UpdateSettingsSchema.safeParse({ ...BASE, ticketReopenWindowDays: 366 }).success,
      false,
    );
    assert.equal(
      UpdateSettingsSchema.safeParse({ ...BASE, ticketReopenWindowDays: 0 }).success,
      false,
    );
    assert.equal(
      UpdateSettingsSchema.safeParse({ ...BASE, bugCloseWindowDays: 365 }).success,
      true,
    );
  });

  it('restricts the payout cycle to the documented enum', () => {
    for (const payoutCycle of ['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']) {
      assert.equal(UpdateSettingsSchema.safeParse({ ...BASE, payoutCycle }).success, true);
    }
    assert.equal(UpdateSettingsSchema.safeParse({ ...BASE, payoutCycle: 'YEARLY' }).success, false);
  });

  it('validates support email, recipient emails, and the day/hour ranges', () => {
    assert.equal(
      UpdateSettingsSchema.safeParse({ ...BASE, supportEmail: 'nope' }).success,
      false,
    );
    assert.equal(
      UpdateSettingsSchema.safeParse({
        ...BASE,
        scheduledReportsRecipients: ['not-an-email'],
      }).success,
      false,
    );
    assert.equal(
      UpdateSettingsSchema.safeParse({ ...BASE, scheduledReportsDayOfWeek: 7 }).success,
      false,
    );
    assert.equal(
      UpdateSettingsSchema.safeParse({ ...BASE, scheduledReportsHourUtc: 24 }).success,
      false,
    );
  });
});
