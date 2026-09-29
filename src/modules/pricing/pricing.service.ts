import { DISCOUNT_BEARER, type DiscountBearer } from '@core/constants/statuses';
import { frozenPaise } from './frozenMoneySql';
import {
  breakdownToRupees,
  computeSubOrderBreakdown,
  reverseFrozenLine,
  splitTaxAmount,
  toPaise,
  type GstPriceBand,
  type PricingLineBreakdown,
  type SubOrderPricingBreakdown,
} from './pricing.engine';

export type QuoteVendorPricingInput = {
  lines: Array<{
    key: string;
    unitPrice: number;
    quantity: number;
    gstPercentage?: number;
    gstPriceBand?: GstPriceBand | null;
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
        gstPriceBand: line.gstPriceBand,
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
      shippingRefundedPaise?: number;
      standingTaxablePaise?: number;
      returnFeeAlreadyCharged?: boolean;
    },
  ) {
    return reverseFrozenLine({
      line,
      returnQuantity,
      reasonCode: opts?.reasonCode,
      shippingChargedPaise: opts?.shippingChargedPaise,
      returnShippingFeePaise: opts?.returnShippingFeePaise,
      shippingRefundedPaise: opts?.shippingRefundedPaise,
      standingTaxablePaise: opts?.standingTaxablePaise,
      returnFeeAlreadyCharged: opts?.returnFeeAlreadyCharged,
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
    /** The supply value and its GST; null on rows written before they were kept. */
    supplyTaxablePaise?: number | null;
    supplyTaxPaise?: number | null;
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
    const gstPercentage = Number(tb.gstPercentage ?? 0);
    // Older rows kept no supply value: it was the taxable value (no platform-funded GST).
    const supplyTaxablePaise =
      row.supplyTaxablePaise != null ? Number(row.supplyTaxablePaise) : taxablePaise;
    const supplyTaxTotalPaise = row.supplyTaxPaise != null ? Number(row.supplyTaxPaise) : taxTotalPaise;
    const interState = toPaise(tb.igst ?? 0) > 0;
    const supplySplit = splitTaxAmount(supplyTaxTotalPaise, !interState);
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
        gstPercentage,
      },
      commissionBasePaise: taxablePaise,
      commissionPaise,
      tcsPaise,
      // Not stored per line; reversals scale the stored net, which already includes it.
      platformFundedDiscountPaise: 0,
      supplyTaxablePaise,
      supplyTax: { ...supplySplit, total: supplyTaxTotalPaise, gstPercentage },
      netPayoutPaise,
    };
  }
}

export const pricingService = new PricingService();

export type { SubOrderPricingBreakdown, PricingLineBreakdown };
