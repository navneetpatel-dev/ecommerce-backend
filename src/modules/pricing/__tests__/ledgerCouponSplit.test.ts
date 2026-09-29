/**
 * A sale ledger's discount splits between the vendor and the platform per ledger, from
 * its frozen amounts — a stacked order carries both, whatever its single bearer — and
 * the SQL form agrees with the TS twin. Built from real engine output.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { DISCOUNT_BEARER } from '@core/constants/statuses';
import { computeSubOrderBreakdown } from '../pricing.engine';
import {
  ledgerCouponSplitPaise,
  sqlLedgerPlatformDiscountPaise,
  sqlLedgerPlatformGstPaise,
  sqlLedgerVendorDiscountPaise,
} from '../frozenMoneySql';

// ₹200 of goods at 18%: a ₹30 discount, ₹10 of it the vendor's own coupon.
const stacked = computeSubOrderBreakdown({
  lines: [{ key: 'a', unitPricePaise: 20000, quantity: 1 }],
  merchandiseDiscountPaise: 3000,
  vendorBorneMerchandiseDiscountPaise: 1000,
  shippingDiscountPaise: 0,
  shippingCostPaise: 0,
  gstPercentage: 18,
  intraState: false,
  commissionRatePercent: 10,
  discountBearer: DISCOUNT_BEARER.PLATFORM,
  tcsRatePercent: 1,
});

const ledger = {
  discountAmountPaise: stacked.merchandiseDiscountPaise,
  taxableAmountPaise: stacked.taxablePaise,
  supplyTaxablePaise: stacked.supplyTaxablePaise,
  taxAmountPaise: stacked.tax.total,
  commissionAmountPaise: stacked.commissionPaise,
  tcsAmountPaise: stacked.tcsPaise,
  netPayoutAmountPaise: stacked.netPayoutPaise,
};

// A row written before the supply value was kept: the platform's share sat in the net.
const legacy = {
  discountAmountPaise: 3000,
  taxableAmountPaise: 17000,
  supplyTaxablePaise: null,
  taxAmountPaise: 3060,
  commissionAmountPaise: 1900,
  tcsAmountPaise: 170,
  netPayoutAmountPaise: 17000 + 2000 + 3060 - 1900 - 170,
};

// Amounts not written by the engine (no discount, but commission outside the net).
const inconsistent = {
  discountAmountPaise: 0,
  taxableAmountPaise: 0,
  supplyTaxablePaise: null,
  taxAmountPaise: 0,
  commissionAmountPaise: 706757,
  tcsAmountPaise: 0,
  netPayoutAmountPaise: 0,
};

describe('ledger coupon split', () => {
  it('splits a stacked discount by who funded it, with the GST the platform pays', () => {
    assert.deepEqual(ledgerCouponSplitPaise(ledger), {
      vendorPaise: 1000,
      platformPaise: 2000,
      platformGstPaise: stacked.platformGstSubsidyPaise,
    });
    assert.equal(stacked.platformGstSubsidyPaise, 360);
  });

  it('reads the platform share from the net on older rows', () => {
    assert.deepEqual(ledgerCouponSplitPaise(legacy), {
      vendorPaise: 1000,
      platformPaise: 2000,
      platformGstPaise: 0,
    });
  });

  it('never splits outside the discount', () => {
    assert.deepEqual(ledgerCouponSplitPaise(inconsistent), {
      vendorPaise: 0,
      platformPaise: 0,
      platformGstPaise: 0,
    });
  });

  describe('SQL twin', () => {
    let dbReady = false;
    before(async () => {
      try {
        await Promise.race([
          sequelize.authenticate(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]);
        dbReady = true;
      } catch {
        dbReady = false;
      }
    });

    it('matches the TS split', async (t) => {
      if (!dbReady) return t.skip('database unavailable');
      for (const row of [ledger, legacy, inconsistent]) {
        const [result] = await sequelize.query<Record<string, string>>(
          `SELECT ${sqlLedgerVendorDiscountPaise('cl')} AS vendor,
                  ${sqlLedgerPlatformDiscountPaise('cl')} AS platform,
                  ${sqlLedgerPlatformGstPaise('cl')} AS gst
           FROM (SELECT :discountAmountPaise::bigint AS "discountAmountPaise",
                        :taxableAmountPaise::bigint AS "taxableAmountPaise",
                        :supplyTaxablePaise::bigint AS "supplyTaxablePaise",
                        :taxAmountPaise::bigint AS "taxAmountPaise",
                        :commissionAmountPaise::bigint AS "commissionAmountPaise",
                        :tcsAmountPaise::bigint AS "tcsAmountPaise",
                        :netPayoutAmountPaise::bigint AS "netPayoutAmountPaise") cl`,
          { replacements: row, type: QueryTypes.SELECT },
        );
        const split = ledgerCouponSplitPaise(row);
        assert.deepEqual(
          [Number(result!.vendor), Number(result!.platform), Number(result!.gst)],
          [split.vendorPaise, split.platformPaise, split.platformGstPaise],
        );
      }
    });
  });
});
