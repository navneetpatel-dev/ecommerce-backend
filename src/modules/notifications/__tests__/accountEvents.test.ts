import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Coupon } from '@database/models/coupon.model';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { UserDevice } from '@database/models/userDevice.model';
import { settingsService } from '@modules/settings/settings.service';
import { describeDevice, deviceFingerprint, recordLoginDevice } from '@modules/auth/loginDevices';
import { notificationsService } from '../notifications.service';
import { issueWelcomeCoupon, notifyAccountStatusChange, notifyPasswordChanged, notifyWelcome } from '../events/accountEvents';

type Row = Record<string, any>;

const OFFER = { welcomeOfferEnabled: true, welcomeOfferPercent: 10, welcomeOfferMaxDiscount: 200, welcomeOfferMinOrder: 0, welcomeOfferValidDays: 30 };

function captureEmails() {
  const sent: Row[] = [];
  mock.method(notificationsService, 'enqueue', async (params: Row) => {
    sent.push(params);
    return null as never;
  });
  mock.method(notificationsService, 'sendWelcome', async (userId: string, data: Row) => {
    sent.push({ type: 'WELCOME', userId, templateData: data });
    return null as never;
  });
  return sent;
}

describe('welcome offer', () => {
  afterEach(() => mock.restoreAll());

  it('issues a single-use, first-order coupon locked to that shopper, from the platform settings', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => OFFER as never);
    mock.method(Coupon, 'findOne', async () => null);
    mock.method(Role, 'findOne', async () => null);
    mock.method(User, 'findAll', async () => [] as never);
    const created: Row[] = [];
    mock.method(Coupon, 'create', async (fields: Row) => {
      created.push(fields);
      return { code: fields.code, endDate: fields.endDate } as never;
    });

    const offer = await issueWelcomeCoupon('user-1');

    assert.match(offer!.code, /^WELCOME-[A-Z2-9]{6}$/);
    assert.equal(created[0]!.type, 'PERCENTAGE');
    assert.equal(created[0]!.value, 10);
    assert.equal(created[0]!.maxDiscountCap, 200);
    assert.deepEqual(created[0]!.userRestriction, { type: 'specific', value: ['user-1'] });
    assert.equal(created[0]!.usageLimitTotal, 1);
    assert.equal(created[0]!.config.welcomeForUserId, 'user-1');
    assert.match(offer!.summary, /10% off your first order \(up to ₹200\) · valid 30 days/);
  });

  it('gives the same coupon back when asked again, and none when the offer is off', async () => {
    mock.method(settingsService, 'getPlatformSettings', async () => OFFER as never);
    mock.method(Coupon, 'findOne', async () => ({ code: 'WELCOME-AAAAAA', endDate: new Date() }) as never);
    const create = mock.method(Coupon, 'create', async () => ({}) as never);
    assert.equal((await issueWelcomeCoupon('user-1'))!.code, 'WELCOME-AAAAAA');
    assert.equal(create.mock.callCount(), 0);

    mock.restoreAll();
    mock.method(settingsService, 'getPlatformSettings', async () => ({ ...OFFER, welcomeOfferEnabled: false }) as never);
    assert.equal(await issueWelcomeCoupon('user-1'), null);
  });

  it('still welcomes the shopper (without a code) if the coupon cannot be issued', async () => {
    const sent = captureEmails();
    mock.method(settingsService, 'getPlatformSettings', async () => { throw new Error('db down'); });

    await notifyWelcome('user-1', 'Karan');

    assert.equal(sent[0]!.type, 'WELCOME');
    assert.equal(sent[0]!.templateData.codeBox, undefined);
  });

  it('puts the code in the welcome email when the offer is on', async () => {
    const sent = captureEmails();
    mock.method(settingsService, 'getPlatformSettings', async () => OFFER as never);
    mock.method(Coupon, 'findOne', async () => ({ code: 'WELCOME-QQQQQQ', endDate: new Date('2026-12-01') }) as never);

    await notifyWelcome('user-1', 'Karan');

    assert.equal(sent[0]!.templateData.codeBox.code, 'WELCOME-QQQQQQ');
    assert.equal(sent[0]!.templateData.couponCode, 'WELCOME-QQQQQQ');
  });
});

describe('account security emails', () => {
  afterEach(() => mock.restoreAll());

  it('tells the owner when the password changed, with a fresh reference each time', async () => {
    const sent = captureEmails();
    await notifyPasswordChanged('user-1', 'reset');
    await new Promise((resolve) => setTimeout(resolve, 2));
    await notifyPasswordChanged('user-1', 'changed');
    assert.equal(sent[0]!.type, 'PASSWORD_CHANGED');
    assert.notEqual(sent[0]!.referenceId, sent[1]!.referenceId);
  });

  it('emails only when an account is blocked or restored', async () => {
    const sent = captureEmails();
    await notifyAccountStatusChange('u', 'ACTIVE', 'BLOCKED', 'Fraud review');
    await notifyAccountStatusChange('u', 'BLOCKED', 'ACTIVE');
    await notifyAccountStatusChange('u', 'ACTIVE', 'ACTIVE');
    assert.deepEqual(sent.map((mail) => mail.type), ['ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED']);
  });
});

describe('login devices', () => {
  afterEach(() => mock.restoreAll());

  const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
  const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';

  it('names the browser and system', () => {
    assert.equal(describeDevice(CHROME_MAC), 'Chrome on macOS');
    assert.equal(describeDevice(SAFARI_IPHONE), 'Safari on iOS');
    assert.equal(describeDevice(null), 'A browser on an unknown system');
    assert.equal(deviceFingerprint(CHROME_MAC), deviceFingerprint(`${CHROME_MAC} extra`), 'same browser family and OS is the same device');
    assert.notEqual(deviceFingerprint(CHROME_MAC), deviceFingerprint(SAFARI_IPHONE));
  });

  function stubDevices(existing: number, created: boolean) {
    mock.method(UserDevice, 'findOrCreate', async () => [{ id: 'dev-1', ipAddress: null, update: async () => undefined }, created] as never);
    mock.method(UserDevice, 'count', async () => existing as never);
    return captureEmails();
  }

  it('records the first device without an alert (nothing to compare with)', async () => {
    const sent = stubDevices(1, true);
    await recordLoginDevice({ id: 'u1' }, { userAgent: CHROME_MAC });
    assert.equal(sent.length, 0);
  });

  it('alerts on a sign-in from a device it has not seen before', async () => {
    const sent = stubDevices(2, true);
    await recordLoginDevice({ id: 'u1' }, { userAgent: SAFARI_IPHONE, ipAddress: '1.2.3.4' });
    assert.equal(sent[0]!.type, 'NEW_DEVICE_LOGIN');
    assert.ok(sent[0]!.templateData.details.some((row: Row) => row.value === 'Safari on iOS'));
  });

  it('stays quiet for a known device', async () => {
    const sent = stubDevices(2, false);
    await recordLoginDevice({ id: 'u1' }, { userAgent: CHROME_MAC });
    assert.equal(sent.length, 0);
  });
});
