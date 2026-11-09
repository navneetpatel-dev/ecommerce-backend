import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bestCashbackOffer, offerCashbackPaise, type LiveCashbackOffer } from '../cashbackOfferEngine';

const offer = (overrides: Partial<LiveCashbackOffer> = {}): LiveCashbackOffer => ({
  id: 'o1',
  name: '5% back',
  percent: 5,
  maxCashback: 100,
  minOrderValue: 999,
  categoryIds: new Set(),
  paymentMethods: [],
  ...overrides,
});

describe('cashback offer engine', () => {
  it('gives the percentage of what the customer pays, capped', () => {
    assert.equal(offerCashbackPaise(offer(), [{ categoryId: null, paidPaise: 150_000 }], 'RAZORPAY'), 7_500);
    assert.equal(offerCashbackPaise(offer(), [{ categoryId: null, paidPaise: 500_000 }], 'RAZORPAY'), 10_000);
    assert.equal(offerCashbackPaise(offer({ maxCashback: null }), [{ categoryId: null, paidPaise: 500_000 }], 'COD'), 25_000);
  });

  it('needs the minimum order value', () => {
    assert.equal(offerCashbackPaise(offer(), [{ categoryId: null, paidPaise: 99_899 }], 'RAZORPAY'), 0);
    assert.equal(offerCashbackPaise(offer(), [{ categoryId: null, paidPaise: 99_900 }], 'RAZORPAY'), 4_995);
  });

  it('counts only lines in its categories toward the minimum and the cashback', () => {
    const scoped = offer({ categoryIds: new Set(['shoes']) });
    const lines = [
      { categoryId: 'shoes', paidPaise: 120_000 },
      { categoryId: 'books', paidPaise: 300_000 },
    ];
    assert.equal(offerCashbackPaise(scoped, lines, 'RAZORPAY'), 6_000);
    assert.equal(offerCashbackPaise(scoped, [{ categoryId: 'books', paidPaise: 300_000 }], 'RAZORPAY'), 0);
  });

  it('applies only to its payment methods, and not before one is chosen', () => {
    const prepaid = offer({ paymentMethods: ['RAZORPAY'] });
    const lines = [{ categoryId: null, paidPaise: 200_000 }];
    assert.equal(offerCashbackPaise(prepaid, lines, 'RAZORPAY'), 10_000);
    assert.equal(offerCashbackPaise(prepaid, lines, 'COD'), 0);
    assert.equal(offerCashbackPaise(prepaid, lines, undefined), 0);
  });

  it('rounds fractional paise down', () => {
    assert.equal(offerCashbackPaise(offer({ percent: 2.5, minOrderValue: 0, maxCashback: null }), [{ categoryId: null, paidPaise: 333 }], 'COD'), 8);
  });

  it('picks the single best offer', () => {
    const lines = [{ categoryId: 'shoes', paidPaise: 400_000 }];
    const best = bestCashbackOffer(
      [offer(), offer({ id: 'o2', name: '10% on shoes', percent: 10, maxCashback: 300, categoryIds: new Set(['shoes']) })],
      lines,
      'COD',
    );
    assert.deepEqual(best, { offerId: 'o2', name: '10% on shoes', amountPaise: 30_000 });
    assert.equal(bestCashbackOffer([offer()], [{ categoryId: null, paidPaise: 1_000 }], 'COD'), null);
  });
});
