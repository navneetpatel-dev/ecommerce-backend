import assert from 'node:assert/strict';
import { after, afterEach, describe, it, mock } from 'node:test';
import { CashbackOffer } from '@database/models/cashbackOffer.model';
import { User } from '@database/models/user.model';
import { ORDER_STATUS } from '@core/constants/statuses';
import { env } from '@config/env';
import { cashbackOffersService } from '@modules/cashbackOffers/cashbackOffers.service';
import { checkoutCashbackOffer } from '@modules/cashbackOffers/checkoutCashbackOffer';
import { cashbackEntryFor } from '@modules/wallet/cashbackHistory.service';

const live = {
  id: 'o1',
  name: '5% back',
  percent: 5,
  maxCashback: 100,
  minOrderValue: 999,
  categoryIds: new Set<string>(),
  paymentMethods: [],
};
const priced = { v1: { paise: { lines: [{ key: 'a', taxablePaise: 100_000, tax: { total: 18_000 } }] } } };

describe('cashback offer at checkout', () => {
  afterEach(() => mock.restoreAll());

  it('gives the best live offer on what the customer pays, GST included', async () => {
    mock.method(cashbackOffersService, 'live', async () => [live]);
    const result = await checkoutCashbackOffer({ pricedByVendor: priced, categoryOf: () => null, coupons: [] });
    assert.deepEqual(result, { offerId: 'o1', name: '5% back', amount: 59 });
  });

  it('stacks with a platform-funded cashback coupon but not a vendor-funded one', async () => {
    mock.method(cashbackOffersService, 'live', async () => [live]);
    const platform = await checkoutCashbackOffer({
      pricedByVendor: priced,
      categoryOf: () => null,
      coupons: [{ type: 'CASHBACK', discountBearer: 'PLATFORM' }],
    });
    assert.equal(platform?.amount, 59);
    const vendor = await checkoutCashbackOffer({
      pricedByVendor: priced,
      categoryOf: () => null,
      coupons: [{ type: 'CASHBACK', discountBearer: 'VENDOR' }],
    });
    assert.equal(vendor, null);
  });
});

describe('cashback history entries', () => {
  const day = 86_400_000;
  const order = (overrides: Record<string, unknown>) =>
    ({
      id: 'ord1',
      createdAt: new Date('2026-11-01T00:00:00Z'),
      status: ORDER_STATUS.CONFIRMED,
      pendingCashbackAmount: '75.00',
      cashbackCreditedAt: null,
      subOrders: [],
      ...overrides,
    }) as never;

  it('is pending with no date until every part is delivered', () => {
    const entry = cashbackEntryFor(
      order({ subOrders: [{ status: ORDER_STATUS.SHIPPED, updatedAt: new Date() }] }),
      ['CB50'],
      null,
    );
    assert.equal(entry.status, 'PENDING');
    assert.equal(entry.expectedCreditOn, null);
    assert.deepEqual(entry.couponCodes, ['CB50']);
  });

  it('expects the credit the configured delay after the last part settles', () => {
    const settled = new Date('2026-11-05T10:00:00Z');
    const entry = cashbackEntryFor(
      order({
        subOrders: [
          { status: ORDER_STATUS.DELIVERED, updatedAt: settled },
          { status: ORDER_STATUS.CANCELLED, updatedAt: new Date('2026-11-02T00:00:00Z') },
        ],
      }),
      [],
      '5% back',
    );
    assert.equal(entry.status, 'PENDING');
    assert.equal(entry.expectedCreditOn?.getTime(), settled.getTime() + env.CASHBACK_CREDIT_DELAY_DAYS * day);
    assert.equal(entry.offerName, '5% back');
  });

  it('is cancelled when the order is cancelled or every part was reversed', () => {
    assert.equal(cashbackEntryFor(order({ status: ORDER_STATUS.CANCELLED }), [], null).status, 'CANCELLED');
    const returned = order({ subOrders: [{ status: ORDER_STATUS.RETURNED, updatedAt: new Date() }] });
    assert.equal(cashbackEntryFor(returned, [], null).status, 'CANCELLED');
  });

  it('is credited with what is in the wallet, and cancelled once clawed back to nothing', () => {
    const credited = cashbackEntryFor(order({ cashbackCreditedAt: new Date() }), [], null);
    assert.equal(credited.status, 'CREDITED');
    assert.equal(credited.amount, 75);
    const clawed = cashbackEntryFor(order({ cashbackCreditedAt: new Date(), pendingCashbackAmount: '0' }), [], null);
    assert.equal(clawed.status, 'CANCELLED');
  });
});

describe('cashback offer admin (database)', () => {
  const created: string[] = [];
  after(async () => {
    await CashbackOffer.destroy({ where: { id: created }, force: true });
  });

  it('creates, edits and soft-deletes an offer, and lists it live while it runs', async () => {
    // The audit log needs a real actor; any seeded user will do.
    const actor = (await User.findOne({ attributes: ['id'] }))!.id;
    const offer = await cashbackOffersService.create(actor, {
      name: 'Test 5% back',
      percent: 5,
      maxCashback: 100,
      minOrderValue: 999,
      categoryIds: [],
      paymentMethods: ['RAZORPAY'],
      startsAt: new Date(Date.now() - 60_000),
      isActive: true,
    });
    created.push(offer.id);
    assert.equal(offer.state, 'LIVE');
    assert.ok((await cashbackOffersService.live()).some((row) => row.id === offer.id));

    await assert.rejects(
      cashbackOffersService.update(actor, offer.id, {
        endsAt: new Date(Date.now() - 120_000),
      }),
      /end must be after the start/,
    );

    const off = await cashbackOffersService.update(actor, offer.id, { isActive: false });
    assert.equal(off.state, 'OFF');
    assert.ok(!(await cashbackOffersService.live()).some((row) => row.id === offer.id));

    await cashbackOffersService.remove(actor, offer.id);
    assert.equal(await CashbackOffer.findByPk(offer.id), null);
  });
});
