import { DISCOUNT_BEARER, type DiscountBearer } from '@core/constants/statuses';
import { allocateProportionally, fromPaise, toPaise, type Paise } from './money';

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
  gstPercentage: number;
  intraState: boolean;
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
  /** Explicit rounding residual if line tax sums drift from suborder tax. */
  roundingAdjustmentPaise: Paise;
};

export type RefundReversalInput = {
  line: PricingLineBreakdown;
  /** Quantity being returned (≤ original). */
  returnQuantity: number;
};

export type RefundReversalBreakdown = {
  refundSubtotalPaise: Paise;
  refundDiscountPaise: Paise;
  refundMerchandisePaise: Paise;
  refundTaxPaise: Paise;
  refundCommissionPaise: Paise;
  refundTcsPaise: Paise;
  refundNetClawbackPaise: Paise;
  /** Amount credited to customer (merchandise + tax). */
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

function commissionBasePaise(
  subtotalPaise: Paise,
  merchandiseDiscountPaise: Paise,
  discountBearer: DiscountBearer | null | undefined,
  vendorBorneMerchandiseDiscountPaise?: Paise,
): Paise {
  if (vendorBorneMerchandiseDiscountPaise != null) {
    return Math.max(
      0,
      subtotalPaise - Math.min(merchandiseDiscountPaise, Math.max(0, Math.round(vendorBorneMerchandiseDiscountPaise))),
    );
  }
  if (discountBearer === DISCOUNT_BEARER.VENDOR) {
    return Math.max(0, subtotalPaise - merchandiseDiscountPaise);
  }
  return subtotalPaise;
}

/**
 * Authoritative per-SubOrder pricing. All money in paise.
 * Order: line subtotals → merchandise discount → tax on post-discount →
 * commission (excludes tax/shipping) → TCS → net payout.
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

  const taxablePaise = Math.max(0, subtotalPaise - merchandiseDiscountPaise);
  const tax = splitTax(taxablePaise, input.gstPercentage, input.intraState);
  const vendorBorne = Math.min(
    merchandiseDiscountPaise,
    input.vendorBorneMerchandiseDiscountPaise != null
      ? Math.max(0, Math.round(input.vendorBorneMerchandiseDiscountPaise))
      : input.discountBearer === DISCOUNT_BEARER.VENDOR
        ? merchandiseDiscountPaise
        : 0,
  );
  const base = commissionBasePaise(
    subtotalPaise,
    merchandiseDiscountPaise,
    input.discountBearer,
    vendorBorne,
  );
  const commissionPaise = Math.round((base * Number(input.commissionRatePercent || 0)) / 100);
  const tcsPaise = Math.round((taxablePaise * Number(input.tcsRatePercent || 0)) / 100);
  const netPayoutPaise = Math.max(0, taxablePaise - commissionPaise - tcsPaise);

  const lineTaxTotals = allocateProportionally(
    tax.total,
    lines.map((line, i) => Math.max(0, line.lineSubtotalPaise - (lineDiscounts[i] ?? 0))),
  );
  const lineCommission = allocateProportionally(
    commissionPaise,
    lines.map((line, i) => {
      const disc = lineDiscounts[i] ?? 0;
      const lineVendorBorne =
        merchandiseDiscountPaise > 0
          ? Math.round((disc * vendorBorne) / merchandiseDiscountPaise)
          : 0;
      return Math.max(0, line.lineSubtotalPaise - lineVendorBorne);
    }),
  );
  const lineTcs = allocateProportionally(
    tcsPaise,
    lines.map((line, i) => Math.max(0, line.lineSubtotalPaise - (lineDiscounts[i] ?? 0))),
  );

  const pricedLines: PricingLineBreakdown[] = lines.map((line, i) => {
    const discountPaise = lineDiscounts[i] ?? 0;
    const lineTaxable = Math.max(0, line.lineSubtotalPaise - discountPaise);
    const lineTaxTotal = lineTaxTotals[i] ?? 0;
    const lineTax = input.intraState
      ? {
          cgst: Math.floor(lineTaxTotal / 2),
          sgst: lineTaxTotal - Math.floor(lineTaxTotal / 2),
          igst: 0,
          total: lineTaxTotal,
          gstPercentage: input.gstPercentage,
        }
      : {
          cgst: 0,
          sgst: 0,
          igst: lineTaxTotal,
          total: lineTaxTotal,
          gstPercentage: input.gstPercentage,
        };
    const commissionBase =
      merchandiseDiscountPaise > 0
        ? Math.max(
            0,
            line.lineSubtotalPaise - Math.round((discountPaise * vendorBorne) / merchandiseDiscountPaise),
          )
        : line.lineSubtotalPaise;
    const commission = lineCommission[i] ?? 0;
    const tcs = lineTcs[i] ?? 0;
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
      tcsPaise: tcs,
      netPayoutPaise: Math.max(0, lineTaxable - commission - tcs),
    };
  });

  const summedLineTax = pricedLines.reduce((sum, line) => sum + line.tax.total, 0);
  let appliedRoundingAdjustmentPaise = tax.total - summedLineTax;
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
  } else {
    appliedRoundingAdjustmentPaise = 0;
  }

  const customerTotalPaise = taxablePaise + tax.total + shippingChargedPaise;

  return {
    lines: pricedLines,
    subtotalPaise,
    merchandiseDiscountPaise,
    shippingDiscountPaise,
    shippingCostPaise,
    shippingChargedPaise,
    taxablePaise,
    tax,
    commissionBasePaise: base,
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

  return {
    refundSubtotalPaise,
    refundDiscountPaise,
    refundMerchandisePaise,
    refundTaxPaise,
    refundCommissionPaise,
    refundTcsPaise,
    refundNetClawbackPaise,
    customerRefundPaise: refundMerchandisePaise + refundTaxPaise,
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
