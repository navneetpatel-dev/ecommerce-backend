import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { taxService } from '@modules/tax/tax.service';
import { previewCustomerPrice } from '../productPricePreview';
import { GstPreviewQuerySchema } from '../products.dto';

const CATEGORY = '11111111-1111-4111-8111-111111111111';

describe('previewCustomerPrice: what the customer page shows for a price and an MRP', () => {
  afterEach(() => mock.restoreAll());
  const gst = (percent: number, band: unknown = null) => mock.method(taxService, 'getGstRateRule', async () => ({ gstPercentage: percent, gstPriceBand: band }) as never);

  it('a ₹1,000 price at 18% GST and a ₹1,499 MRP: customer pays ₹1,180, shown struck through, 21% off, saves ₹319', async () => {
    gst(18);
    assert.deepEqual(await previewCustomerPrice(CATEGORY, 1000, 1499), {
      gstPercentage: 18, displayPrice: 1180, compareAtPrice: 1499, showMrp: true, discountPercent: 21, savings: 319, variantDisplayPrices: [],
    });
  });

  it('an MRP equal to what the customer pays shows no discount; no MRP shows none either', async () => {
    gst(18);
    const equal = await previewCustomerPrice(CATEGORY, 1000, 1180);
    assert.deepEqual([equal.showMrp, equal.discountPercent, equal.savings], [false, null, null]);
    const none = await previewCustomerPrice(CATEGORY, 1000, null);
    assert.deepEqual([none.compareAtPrice, none.showMrp, none.discountPercent], [null, false, null]);
  });

  it('an MRP below what the customer pays shows nothing (the form warns separately)', async () => {
    gst(18);
    const below = await previewCustomerPrice(CATEGORY, 1000, 1100);
    assert.deepEqual([below.showMrp, below.discountPercent, below.savings], [false, null, null]);
  });

  it('uses the band rate above the category threshold, like the product page', async () => {
    gst(5, { thresholdPaise: 100000, gstPercentageAbove: 12 });
    assert.equal((await previewCustomerPrice(CATEGORY, 2000, 3000)).gstPercentage, 12);
  });

  it('the query accepts an optional MRP and caps price and MRP', () => {
    assert.equal(GstPreviewQuerySchema.safeParse({ categoryId: CATEGORY, price: 1000 }).success, true);
    assert.equal(GstPreviewQuerySchema.safeParse({ categoryId: CATEGORY, price: 1000, compareAtPrice: 1499 }).success, true);
    assert.equal(GstPreviewQuerySchema.safeParse({ categoryId: CATEGORY, price: 1000, compareAtPrice: 0 }).success, false);
    assert.equal(GstPreviewQuerySchema.safeParse({ categoryId: CATEGORY, price: 10_000_001 }).success, false);
  });

  it('prices each variant the way the product page does (GST included), in order', async () => {
    gst(18);
    assert.deepEqual((await previewCustomerPrice(CATEGORY, 1000, null, [1000, 2000])).variantDisplayPrices, [1180, 2360]);
  });

  it('the query reads variant prices from a comma list, capped at 20 positive prices', () => {
    const parse = (variantPrices: unknown) => GstPreviewQuerySchema.safeParse({ categoryId: CATEGORY, price: 1000, variantPrices });
    assert.deepEqual((parse('1000,2000') as { data: { variantPrices: number[] } }).data.variantPrices, [1000, 2000]);
    assert.equal(parse(Array.from({ length: 21 }, () => '5').join(',')).success, false);
    assert.equal(parse('0,5').success, false);
    assert.equal(parse('abc').success, false);
  });
});
