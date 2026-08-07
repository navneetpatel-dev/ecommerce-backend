import { DISCOUNT_BEARER, type DiscountBearer, type ReturnReason } from '@core/constants/statuses';
import { allocateProportionally, fromPaise, toPaise, type Paise } from './money';
import { resolveShippingRefundPolicy } from './shippingRefundPolicy';

export type TaxBreakdownPaise = {
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  total: Paise;
  gstPercentage: number;
};

export type PricingLineInput = {
  /** Stable key for mapping back (variantId / cartItemId). */
  key: string;
  unitPricePaise: Paise;
  quantity: number;
  /** Per-line GST %; falls back to SubOrderPricingInput.gstPercentage. */
  gstPercentage?: number;
  /** Per-line commission %; falls back to SubOrderPricingInput.commissionRatePercent. */
  commissionRatePercent?: number;
};

export type PricingLineBreakdown = {
  key: string;
  quantity: number;
  unitPricePaise: Paise;
  lineSubtotalPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  tax: TaxBreakdownPaise;
  commissionBasePaise: Paise;
  commissionPaise: Paise;
  tcsPaise: Paise;
  netPayoutPaise: Paise;
};

export type SubOrderPricingInput = {
  lines: PricingLineInput[];
  /** Merchandise coupon discount for this vendor (not shipping). */
  merchandiseDiscountPaise: Paise;
  /**
   * Portion of merchandise discount borne by the vendor (reduces commission base).
   * When omitted, falls back to discountBearer (VENDOR → full discount, PLATFORM → 0).
   */
  vendorBorneMerchandiseDiscountPaise?: Paise;
  /** Shipping discount (e.g. FREE_SHIPPING share). */
  shippingDiscountPaise: Paise;
  shippingCostPaise: Paise;
  /** Default GST when a line omits gstPercentage. */
  gstPercentage: number;
  intraState: boolean;
  /** Default commission when a line omits commissionRatePercent. */
  commissionRatePercent: number;
  discountBearer: DiscountBearer | null | undefined;
  /** Marketplace TCS rate percent (0 disables). */
  tcsRatePercent: number;
};

export type SubOrderPricingBreakdown = {
  lines: PricingLineBreakdown[];
  subtotalPaise: Paise;
  merchandiseDiscountPaise: Paise;
  shippingDiscountPaise: Paise;
  shippingCostPaise: Paise;
  shippingChargedPaise: Paise;
  taxablePaise: Paise;
  tax: TaxBreakdownPaise;
  commissionBasePaise: Paise;
  commissionPaise: Paise;
  tcsPaise: Paise;
  netPayoutPaise: Paise;
  /** Customer pays for this vendor slice (excl. cashback). */
  customerTotalPaise: Paise;
  /** Explicit rounding residual if line tax sums drift from a same-rate suborder tax. */
  roundingAdjustmentPaise: Paise;
};

export type RefundReversalInput = {
  line: PricingLineBreakdown;
  /** Quantity being returned (≤ original). */
  returnQuantity: number;
  /** Return reason — drives shipping refund policy when provided. */
  reasonCode?: ReturnReason;
  /** Original shipping charged on the sub-order (paise). */
  shippingChargedPaise?: Paise;
  /** Configurable return shipping fee (paise). */
  returnShippingFeePaise?: Paise;
  /** True when outbound shipping was already refunded on a prior return. */
  shippingAlreadyRefunded?: boolean;
};

export type RefundReversalBreakdown = {
  refundSubtotalPaise: Paise;
  refundDiscountPaise: Paise;
  refundMerchandisePaise: Paise;
  refundTaxPaise: Paise;
  refundCommissionPaise: Paise;
  refundTcsPaise: Paise;
  refundNetClawbackPaise: Paise;
  shippingRefundPaise: Paise;
  returnShippingFeePaise: Paise;
  /** Amount credited to customer (merchandise + tax ± shipping). */
  customerRefundPaise: Paise;
};

function splitTax(taxablePaise: Paise, gstPercentage: number, intraState: boolean): TaxBreakdownPaise {
  const total = Math.round((taxablePaise * gstPercentage) / 100);
  if (intraState) {
    const half = Math.floor(total / 2);
    const other = total - half;
    return {
      cgst: half,
      sgst: other,
      igst: 0,
      total,
      gstPercentage,
    };
  }
  return {
    cgst: 0,
    sgst: 0,
    igst: total,
    total,
    gstPercentage,
  };
}

/**
 * Authoritative per-SubOrder pricing. All money in paise.
 * Order: line subtotals → merchandise discount → tax on post-discount (per-line GST) →
 * commission per-line (excludes tax/shipping) → TCS → net payout.
 */
export function computeSubOrderBreakdown(input: SubOrderPricingInput): SubOrderPricingBreakdown {
  const lines = input.lines.map((line) => {
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    const unit = Math.max(0, Math.round(line.unitPricePaise));
    return {
      key: line.key,
      quantity: qty,
      unitPricePaise: unit,
      lineSubtotalPaise: unit * qty,
      gstPercentage: Number(line.gstPercentage ?? input.gstPercentage ?? 0),
      commissionRatePercent: Number(line.commissionRatePercent ?? input.commissionRatePercent ?? 0),
    };
  });

  const subtotalPaise = lines.reduce((sum, line) => sum + line.lineSubtotalPaise, 0);
  const merchandiseDiscountPaise = Math.min(
    Math.max(0, Math.round(input.merchandiseDiscountPaise)),
    subtotalPaise,
  );
  const shippingCostPaise = Math.max(0, Math.round(input.shippingCostPaise));
  const shippingDiscountPaise = Math.min(
    Math.max(0, Math.round(input.shippingDiscountPaise)),
    shippingCostPaise,
  );
  const shippingChargedPaise = shippingCostPaise - shippingDiscountPaise;

  const lineDiscounts = allocateProportionally(
    merchandiseDiscountPaise,
    lines.map((line) => line.lineSubtotalPaise),
  );

  const vendorBorne = Math.min(
    merchandiseDiscountPaise,
    input.vendorBorneMerchandiseDiscountPaise != null
      ? Math.max(0, Math.round(input.vendorBorneMerchandiseDiscountPaise))
      : input.discountBearer === DISCOUNT_BEARER.VENDOR
        ? merchandiseDiscountPaise
        : 0,
  );

  const taxablePaise = Math.max(0, subtotalPaise - merchandiseDiscountPaise);

  const pricedLines: PricingLineBreakdown[] = lines.map((line, i) => {
    const discountPaise = lineDiscounts[i] ?? 0;
    const lineTaxable = Math.max(0, line.lineSubtotalPaise - discountPaise);
    const lineTax = splitTax(lineTaxable, line.gstPercentage, input.intraState);
    const lineVendorBorne =
      merchandiseDiscountPaise > 0
        ? Math.round((discountPaise * vendorBorne) / merchandiseDiscountPaise)
        : 0;
    const commissionBase = Math.max(0, line.lineSubtotalPaise - lineVendorBorne);
    const commission = Math.round((commissionBase * line.commissionRatePercent) / 100);
    // TCS allocated later from suborder total so sum matches exactly
    return {
      key: line.key,
      quantity: line.quantity,
      unitPricePaise: line.unitPricePaise,
      lineSubtotalPaise: line.lineSubtotalPaise,
      discountPaise,
      taxablePaise: lineTaxable,
      tax: lineTax,
      commissionBasePaise: commissionBase,
      commissionPaise: commission,
      tcsPaise: 0,
      netPayoutPaise: 0,
    };
  });

  const tcsPaise = Math.round((taxablePaise * Number(input.tcsRatePercent || 0)) / 100);
  const lineTcs = allocateProportionally(
    tcsPaise,
    pricedLines.map((line) => line.taxablePaise),
  );
  for (let i = 0; i < pricedLines.length; i += 1) {
    const line = pricedLines[i]!;
    line.tcsPaise = lineTcs[i] ?? 0;
    line.netPayoutPaise = Math.max(0, line.taxablePaise - line.commissionPaise - line.tcsPaise);
  }

  let taxTotal = pricedLines.reduce((sum, line) => sum + line.tax.total, 0);
  let taxCgst = pricedLines.reduce((sum, line) => sum + line.tax.cgst, 0);
  let taxSgst = pricedLines.reduce((sum, line) => sum + line.tax.sgst, 0);
  let taxIgst = pricedLines.reduce((sum, line) => sum + line.tax.igst, 0);

  // When all lines share one GST rate, reconcile to tax(suborder taxable) and expose residual.
  const uniqueGst = [...new Set(lines.map((line) => line.gstPercentage))];
  let appliedRoundingAdjustmentPaise = 0;
  if (uniqueGst.length === 1) {
    const expected = splitTax(taxablePaise, uniqueGst[0]!, input.intraState);
    appliedRoundingAdjustmentPaise = expected.total - taxTotal;
    if (appliedRoundingAdjustmentPaise !== 0 && pricedLines.length > 0) {
      const target = pricedLines.reduce((best, line) =>
        line.taxablePaise > best.taxablePaise ? line : best,
      );
      target.tax.total += appliedRoundingAdjustmentPaise;
      if (input.intraState) {
        target.tax.sgst += appliedRoundingAdjustmentPaise;
      } else {
        target.tax.igst += appliedRoundingAdjustmentPaise;
      }
      target.netPayoutPaise = Math.max(
        0,
        target.taxablePaise - target.commissionPaise - target.tcsPaise,
      );
      taxTotal = expected.total;
      taxCgst = pricedLines.reduce((sum, line) => sum + line.tax.cgst, 0);
      taxSgst = pricedLines.reduce((sum, line) => sum + line.tax.sgst, 0);
      taxIgst = pricedLines.reduce((sum, line) => sum + line.tax.igst, 0);
    } else {
      appliedRoundingAdjustmentPaise = 0;
    }
  }

  const commissionBasePaise = pricedLines.reduce((sum, line) => sum + line.commissionBasePaise, 0);
  const commissionPaise = pricedLines.reduce((sum, line) => sum + line.commissionPaise, 0);
  const netPayoutPaise = Math.max(0, taxablePaise - commissionPaise - tcsPaise);
  const customerTotalPaise = taxablePaise + taxTotal + shippingChargedPaise;

  const displayGst =
    uniqueGst.length === 1
      ? uniqueGst[0]!
      : taxablePaise > 0
        ? Math.round(
            (pricedLines.reduce((sum, line) => sum + line.taxablePaise * line.tax.gstPercentage, 0) /
              taxablePaise) *
              100,
          ) / 100
        : input.gstPercentage;

  return {
    lines: pricedLines,
    subtotalPaise,
    merchandiseDiscountPaise,
    shippingDiscountPaise,
    shippingCostPaise,
    shippingChargedPaise,
    taxablePaise,
    tax: {
      cgst: taxCgst,
      sgst: taxSgst,
      igst: taxIgst,
      total: taxTotal,
      gstPercentage: displayGst,
    },
    commissionBasePaise,
    commissionPaise,
    tcsPaise,
    netPayoutPaise,
    customerTotalPaise,
    roundingAdjustmentPaise: appliedRoundingAdjustmentPaise,
  };
}

/** Reverse a frozen line breakdown for a partial/full return (proportional by qty). */
export function reverseFrozenLine(input: RefundReversalInput): RefundReversalBreakdown {
  const { line, returnQuantity } = input;
  const qty = Math.max(0, Math.min(Math.floor(returnQuantity), line.quantity));
  if (line.quantity <= 0 || qty <= 0) {
    return {
      refundSubtotalPaise: 0,
      refundDiscountPaise: 0,
      refundMerchandisePaise: 0,
      refundTaxPaise: 0,
      refundCommissionPaise: 0,
      refundTcsPaise: 0,
      refundNetClawbackPaise: 0,
      shippingRefundPaise: 0,
      returnShippingFeePaise: 0,
      customerRefundPaise: 0,
    };
  }

  const ratioNum = qty;
  const ratioDen = line.quantity;
  const scale = (value: Paise) => Math.round((value * ratioNum) / ratioDen);

  const refundSubtotalPaise = scale(line.lineSubtotalPaise);
  const refundDiscountPaise = scale(line.discountPaise);
  const refundMerchandisePaise = scale(line.taxablePaise);
  const refundTaxPaise = scale(line.tax.total);
  const refundCommissionPaise = scale(line.commissionPaise);
  const refundTcsPaise = scale(line.tcsPaise);
  const refundNetClawbackPaise = scale(line.netPayoutPaise);

  let shippingRefundPaise = 0;
  let returnShippingFeePaise = 0;
  if (input.reasonCode) {
    const policy = resolveShippingRefundPolicy(input.reasonCode);
    if (policy.refundOriginalShipping && !input.shippingAlreadyRefunded) {
      shippingRefundPaise = Math.max(0, Math.round(input.shippingChargedPaise ?? 0));
    }
    if (policy.deductReturnShippingFee) {
      returnShippingFeePaise = Math.max(0, Math.round(input.returnShippingFeePaise ?? 0));
    }
  }

  const customerRefundPaise = Math.max(
    0,
    refundMerchandisePaise + refundTaxPaise + shippingRefundPaise - returnShippingFeePaise,
  );

  return {
    refundSubtotalPaise,
    refundDiscountPaise,
    refundMerchandisePaise,
    refundTaxPaise,
    refundCommissionPaise,
    refundTcsPaise,
    refundNetClawbackPaise,
    shippingRefundPaise,
    returnShippingFeePaise,
    customerRefundPaise,
  };
}

export function breakdownToRupees(breakdown: SubOrderPricingBreakdown) {
  return {
    subtotal: fromPaise(breakdown.subtotalPaise),
    merchandiseDiscount: fromPaise(breakdown.merchandiseDiscountPaise),
    shippingDiscount: fromPaise(breakdown.shippingDiscountPaise),
    shippingCost: fromPaise(breakdown.shippingCostPaise),
    shippingCharged: fromPaise(breakdown.shippingChargedPaise),
    taxableAmount: fromPaise(breakdown.taxablePaise),
    tax: {
      cgst: fromPaise(breakdown.tax.cgst),
      sgst: fromPaise(breakdown.tax.sgst),
      igst: fromPaise(breakdown.tax.igst),
      total: fromPaise(breakdown.tax.total),
      gstPercentage: breakdown.tax.gstPercentage,
    },
    commissionBase: fromPaise(breakdown.commissionBasePaise),
    commissionAmount: fromPaise(breakdown.commissionPaise),
    tcsAmount: fromPaise(breakdown.tcsPaise),
    netPayout: fromPaise(breakdown.netPayoutPaise),
    customerTotal: fromPaise(breakdown.customerTotalPaise),
    lines: breakdown.lines.map((line) => ({
      key: line.key,
      quantity: line.quantity,
      unitPrice: fromPaise(line.unitPricePaise),
      lineSubtotal: fromPaise(line.lineSubtotalPaise),
      discountAmount: fromPaise(line.discountPaise),
      taxableAmount: fromPaise(line.taxablePaise),
      tax: {
        cgst: fromPaise(line.tax.cgst),
        sgst: fromPaise(line.tax.sgst),
        igst: fromPaise(line.tax.igst),
        total: fromPaise(line.tax.total),
        gstPercentage: line.tax.gstPercentage,
      },
      commissionBase: fromPaise(line.commissionBasePaise),
      commissionAmount: fromPaise(line.commissionPaise),
      tcsAmount: fromPaise(line.tcsPaise),
      netPayout: fromPaise(line.netPayoutPaise),
    })),
  };
}

export { toPaise, fromPaise };
