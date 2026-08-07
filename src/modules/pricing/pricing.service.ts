import { DISCOUNT_BEARER, type DiscountBearer } from '@core/constants/statuses';
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

  reverseLineFromFrozen(line: PricingLineBreakdown, returnQuantity: number) {
    return reverseFrozenLine({ line, returnQuantity });
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
    const unitPricePaise =
      row.unitPricePaise != null && Number(row.unitPricePaise) > 0
        ? Number(row.unitPricePaise)
        : toPaise(row.unitPrice);
    const lineSubtotalPaise = unitPricePaise * quantity;
    const discountPaise =
      row.discountAmountPaise != null
        ? Number(row.discountAmountPaise)
        : toPaise(row.discountAmount ?? 0);
    const taxablePaise =
      row.taxableAmountPaise != null && Number(row.taxableAmountPaise) > 0
        ? Number(row.taxableAmountPaise)
        : row.taxableAmount != null
          ? toPaise(row.taxableAmount)
          : Math.max(0, lineSubtotalPaise - discountPaise);
    const taxTotalPaise =
      row.taxAmountPaise != null && Number(row.taxAmountPaise) > 0
        ? Number(row.taxAmountPaise)
        : toPaise(row.taxAmount ?? 0);
    const tb = row.taxBreakdown ?? {};
    const commissionPaise =
      row.commissionAmountPaise != null
        ? Number(row.commissionAmountPaise)
        : toPaise(row.commissionAmount ?? 0);
    const tcsPaise =
      row.tcsAmountPaise != null ? Number(row.tcsAmountPaise) : toPaise(row.tcsAmount ?? 0);
    const netPayoutPaise =
      row.netPayoutAmountPaise != null && Number(row.netPayoutAmountPaise) > 0
        ? Number(row.netPayoutAmountPaise)
        : row.netPayoutAmount != null
          ? toPaise(row.netPayoutAmount)
          : Math.max(0, taxablePaise - commissionPaise - tcsPaise);
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
