import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { categoriesService } from '@modules/categories/categories.service';
import { computeSubOrderBreakdown, gstRateForPieces } from '@modules/pricing/pricing.engine';
import { taxRepository } from '@modules/tax/tax.repository';
import { taxService } from '@modules/tax/tax.service';
import { CreateTaxRuleSchema } from '@modules/tax/tax.dto';

// Apparel-style band: up to ₹2,500 a piece 5%, above it 18%.
const band = { thresholdPaise: 250_000, gstPercentageAbove: 18 };

function price(
  unitPricePaise: number,
  quantity: number,
  merchandiseDiscountPaise = 0,
  discountBearer: 'VENDOR' | 'PLATFORM' | null = null,
) {
  return computeSubOrderBreakdown({
    lines: [{ key: 'l1', unitPricePaise, quantity, gstPercentage: 5, gstPriceBand: band }],
    merchandiseDiscountPaise,
    shippingDiscountPaise: 0,
    shippingCostPaise: 0,
    gstPercentage: 5,
    intraState: false,
    commissionRatePercent: 10,
    discountBearer,
    tcsRatePercent: 0,
  });
}

describe('GST price band', () => {
  afterEach(() => mock.restoreAll());

  it('charges the base rate up to the threshold and the higher rate above it', () => {
    assert.equal(gstRateForPieces(5, band, 250_000, 1), 5);
    assert.equal(gstRateForPieces(5, band, 250_001, 1), 18);
    assert.equal(gstRateForPieces(5, null, 900_000, 1), 5);
  });

  it('decides by the value of each piece, not the line', () => {
    // Three ₹2,000 shirts: ₹6,000 in all, but each piece is under ₹2,500.
    const shirts = price(200_000, 3);
    assert.equal(shirts.lines[0]!.tax.gstPercentage, 5);
    assert.equal(shirts.tax.igst, 30_000);
    // One ₹4,000 jacket: 18%.
    const jacket = price(400_000, 1);
    assert.equal(jacket.lines[0]!.tax.gstPercentage, 18);
    assert.equal(jacket.tax.igst, 72_000);
  });

  it("uses the value of supply: the vendor's own discount can move a piece into the lower band", () => {
    // ₹2,700 less the vendor's ₹300 off is ₹2,400 a piece: 5%, not 18%.
    const discounted = price(270_000, 1, 30_000, 'VENDOR');
    assert.equal(discounted.lines[0]!.taxablePaise, 240_000);
    assert.equal(discounted.lines[0]!.tax.gstPercentage, 5);
    assert.equal(discounted.tax.total, 12_000);
    assert.equal(discounted.supplyTaxablePaise, 240_000);
  });

  it("a platform-funded coupon does not lower the value of supply, so not the band either", () => {
    // The platform pays the vendor its ₹300: the piece is still sold for ₹2,700 (18%).
    const discounted = price(270_000, 1, 30_000, 'PLATFORM');
    assert.equal(discounted.supplyTaxablePaise, 270_000);
    assert.equal(discounted.supplyTax.total, 48_600);
    assert.equal(discounted.lines[0]!.tax.gstPercentage, 18);
    // The customer pays GST on their ₹2,400; the platform pays the other ₹54.
    assert.equal(discounted.tax.total, 43_200);
    assert.equal(discounted.platformGstSubsidyPaise, 5_400);
  });

  it('resolves the band from the category tax rule', async () => {
    mock.method(categoriesService, 'walkCategoryAncestors', async () => [{ id: 'apparel' }] as never);
    mock.method(taxRepository, 'findByCategory', async () => ({
      gstPercentage: 5,
      hsnCode: '6109',
      priceBandThreshold: 2500,
      gstPercentageAbove: 18,
    }) as never);
    assert.deepEqual(await taxService.getGstRateRule('apparel'), { gstPercentage: 5, gstPriceBand: band });
  });

  it('takes both band fields or neither', () => {
    assert.equal(CreateTaxRuleSchema.safeParse({ gstPercentage: 5, priceBandThreshold: 2500 }).success, false);
    assert.equal(
      CreateTaxRuleSchema.safeParse({ gstPercentage: 5, priceBandThreshold: 2500, gstPercentageAbove: 18 }).success,
      true,
    );
    assert.equal(CreateTaxRuleSchema.safeParse({ gstPercentage: 18 }).success, true);
  });
});

describe('product page GST follows the band', () => {
  it("shows each variant's own rate and GST-inclusive price", async () => {
    const { pdpTaxAtPrice } = await import('@modules/products/products.service');
    const policy = { gstPercentage: 5, gstPriceBand: band, taxInclusive: true };
    assert.deepEqual(pdpTaxAtPrice(policy, 2000), { gstPercentage: 5, taxInclusivePrice: 2100 });
    assert.deepEqual(pdpTaxAtPrice(policy, 4000), { gstPercentage: 18, taxInclusivePrice: 4720 });
    // Not a tax-inclusive product: the rate still follows the band, no inclusive figure.
    assert.deepEqual(pdpTaxAtPrice({ ...policy, taxInclusive: false }, 4000), {
      gstPercentage: 18,
      taxInclusivePrice: null,
    });
  });
});
