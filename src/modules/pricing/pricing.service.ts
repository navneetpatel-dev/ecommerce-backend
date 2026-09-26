import { DISCOUNT_BEARER, type DiscountBearer } from '@core/constants/statuses';
import { frozenPaise } from './frozenMoneySql';
import {
  breakdownToRupees,
  computeSubOrderBreakdown,
  reverseFrozenLine,
  toPaise,
  type PricingLineBreakdown,
  type SubOrderPricingBreakdown,
} from './pricing.engine';

export type QuoteVendorPricingInput = {
  lines: Array<{
    key: string;
    unitPrice: number;
    quantity: number;
    gstPercentage?: number;
    commissionRatePercent?: number;
  }>;
  merchandiseDiscount: number;
  /** Vendor-borne portion of merchandise discount (mixed platform+vendor coupons). */
  vendorBorneMerchandiseDiscount?: number;
  shippingDiscount: number;
  shippingCost: number;
  /** Fallback GST when a line omits gstPercentage. */
  gstPercentage: number;
  vendorStateCode: string;
  shippingStateCode: string;
  /** Fallback commission when a line omits commissionRatePercent. */
  commissionRatePercent: number;
  discountBearer: DiscountBearer | null | undefined;
  tcsRatePercent: number;
};

/**
 * Orchestrates PricingEngine for quote/checkout callers.
 * Converts rupee inputs → paise, runs engine, returns rupee snapshot.
 */
export class PricingService {
  computeVendorBreakdown(input: QuoteVendorPricingInput) {
    const intraState =
      String(input.vendorStateCode || '').trim().toUpperCase() ===
      String(input.shippingStateCode || '').trim().toUpperCase();

    const merchandiseDiscountPaise = toPaise(input.merchandiseDiscount);
    const vendorBorne =
      input.vendorBorneMerchandiseDiscount != null
        ? toPaise(input.vendorBorneMerchandiseDiscount)
        : input.discountBearer === DISCOUNT_BEARER.VENDOR
          ? merchandiseDiscountPaise
          : 0;

    const breakdown = computeSubOrderBreakdown({
      lines: input.lines.map((line) => ({
        key: line.key,
        unitPricePaise: toPaise(line.unitPrice),
        quantity: line.quantity,
        gstPercentage: line.gstPercentage,
        commissionRatePercent: line.commissionRatePercent,
      })),
      merchandiseDiscountPaise,
      vendorBorneMerchandiseDiscountPaise: vendorBorne,
      shippingDiscountPaise: toPaise(input.shippingDiscount),
      shippingCostPaise: toPaise(input.shippingCost),
      gstPercentage: Number(input.gstPercentage),
      intraState,
      commissionRatePercent: Number(input.commissionRatePercent),
      discountBearer: input.discountBearer ?? DISCOUNT_BEARER.PLATFORM,
      tcsRatePercent: Number(input.tcsRatePercent || 0),
    });

    return {
      paise: breakdown,
      rupees: breakdownToRupees(breakdown),
    };
  }

  reverseLineFromFrozen(
    line: PricingLineBreakdown,
    returnQuantity: number,
    opts?: {
      reasonCode?: import('@core/constants/statuses').ReturnReason;
      shippingChargedPaise?: number;
      returnShippingFeePaise?: number;
      shippingAlreadyRefunded?: boolean;
    },
  ) {
    return reverseFrozenLine({
      line,
      returnQuantity,
      reasonCode: opts?.reasonCode,
      shippingChargedPaise: opts?.shippingChargedPaise,
      returnShippingFeePaise: opts?.returnShippingFeePaise,
      shippingAlreadyRefunded: opts?.shippingAlreadyRefunded,
    });
  }

  /** Rebuild a frozen line snapshot from persisted OrderItem columns (prefer paise). */
  frozenLineFromOrderItem(row: {
    id: string;
    quantity: number;
    taxBreakdown?: { cgst?: number; sgst?: number; igst?: number; gstPercentage?: number } | null;
    unitPricePaise: number;
    discountAmountPaise: number;
    taxableAmountPaise: number;
    taxAmountPaise: number;
    commissionAmountPaise: number;
    tcsAmountPaise: number;
    netPayoutAmountPaise: number;
  }): PricingLineBreakdown {
    const quantity = Number(row.quantity);
    // The paise columns are the only stored money value; see frozenPaise.
    const unitPricePaise = frozenPaise(row.unitPricePaise);
    const lineSubtotalPaise = unitPricePaise * quantity;
    const discountPaise = frozenPaise(row.discountAmountPaise);
    const taxablePaise = frozenPaise(row.taxableAmountPaise);
    const taxTotalPaise = frozenPaise(row.taxAmountPaise);
    const tb = row.taxBreakdown ?? {};
    const commissionPaise = frozenPaise(row.commissionAmountPaise);
    const tcsPaise = frozenPaise(row.tcsAmountPaise);
    const netPayoutPaise = frozenPaise(row.netPayoutAmountPaise);
    return {
      key: row.id,
      quantity,
      unitPricePaise,
      lineSubtotalPaise,
      discountPaise,
      taxablePaise,
      tax: {
        cgst: toPaise(tb.cgst ?? 0),
        sgst: toPaise(tb.sgst ?? 0),
        igst: toPaise(tb.igst ?? 0),
        total: taxTotalPaise,
        gstPercentage: Number(tb.gstPercentage ?? 0),
      },
      commissionBasePaise: taxablePaise,
      commissionPaise,
      tcsPaise,
      // Not stored per line; reversals scale the stored net, which already includes it.
      platformFundedDiscountPaise: 0,
      netPayoutPaise,
    };
  }
}

export const pricingService = new PricingService();

export type { SubOrderPricingBreakdown, PricingLineBreakdown };
