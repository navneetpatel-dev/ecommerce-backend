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
    unitPrice: number;
    discountAmount?: number | null;
    taxableAmount?: number | null;
    taxAmount?: number | null;
    taxBreakdown?: { cgst?: number; sgst?: number; igst?: number; gstPercentage?: number } | null;
    commissionAmount?: number | null;
    tcsAmount?: number | null;
    netPayoutAmount?: number | null;
    unitPricePaise?: number | null;
    discountAmountPaise?: number | null;
    taxableAmountPaise?: number | null;
    taxAmountPaise?: number | null;
    commissionAmountPaise?: number | null;
    tcsAmountPaise?: number | null;
    netPayoutAmountPaise?: number | null;
  }): PricingLineBreakdown {
    const quantity = Number(row.quantity);
    // Paise columns are the stored value (NULL = pre-snapshot row); see frozenPaise.
    const unitPricePaise = frozenPaise(row.unitPricePaise, row.unitPrice);
    const lineSubtotalPaise = unitPricePaise * quantity;
    const discountPaise = frozenPaise(row.discountAmountPaise, row.discountAmount);
    const taxablePaise =
      row.taxableAmountPaise == null && row.taxableAmount == null
        ? Math.max(0, lineSubtotalPaise - discountPaise)
        : frozenPaise(row.taxableAmountPaise, row.taxableAmount);
    const taxTotalPaise = frozenPaise(row.taxAmountPaise, row.taxAmount);
    const tb = row.taxBreakdown ?? {};
    const commissionPaise = frozenPaise(row.commissionAmountPaise, row.commissionAmount);
    const tcsPaise = frozenPaise(row.tcsAmountPaise, row.tcsAmount);
    const netPayoutPaise =
      row.netPayoutAmountPaise == null && row.netPayoutAmount == null
        ? Math.max(0, taxablePaise - commissionPaise - tcsPaise)
        : frozenPaise(row.netPayoutAmountPaise, row.netPayoutAmount);
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
      netPayoutPaise,
    };
  }
}

export const pricingService = new PricingService();

export type { SubOrderPricingBreakdown, PricingLineBreakdown };
