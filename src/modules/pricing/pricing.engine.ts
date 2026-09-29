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

/**
 * A GST rate that depends on the value of each piece (e.g. apparel and footwear): above
 * `thresholdPaise` per piece — its value after discount — the higher rate applies.
 */
export type GstPriceBand = {
  thresholdPaise: Paise;
  gstPercentageAbove: number;
};

/**
 * The GST % for a line of `quantity` pieces with `taxablePaise` between them: the band's
 * higher rate when each piece is worth more than its threshold, else the base rate.
 */
export function gstRateForPieces(
  baseGstPercentage: number,
  band: GstPriceBand | null | undefined,
  taxablePaise: Paise,
  quantity: number,
): number {
  if (!band || quantity <= 0) return baseGstPercentage;
  // Per-piece value above the threshold, compared without dividing (no rounding).
  return taxablePaise > band.thresholdPaise * quantity ? band.gstPercentageAbove : baseGstPercentage;
}

export type PricingLineInput = {
  /** Stable key for mapping back (variantId / cartItemId). */
  key: string;
  unitPricePaise: Paise;
  quantity: number;
  /** Per-line GST %; falls back to SubOrderPricingInput.gstPercentage. */
  gstPercentage?: number;
  /** Per-piece value band that raises the line's GST % (see `gstRateForPieces`). */
  gstPriceBand?: GstPriceBand | null;
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
  /** The platform-funded part of the line's discount, which the platform pays the vendor. */
  platformFundedDiscountPaise: Paise;
  /**
   * The value of the vendor's supply for GST: the line before the platform's share of
   * the coupon (the platform's reimbursement is consideration for the sale), after the
   * vendor's own. Equal to `taxablePaise` when the platform funds no coupon.
   */
  supplyTaxablePaise: Paise;
  /** GST on the supply value — the vendor's invoice charges this; the platform pays the part the customer does not. */
  supplyTax: TaxBreakdownPaise;
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
  /** The platform-funded part of the merchandise discount, paid to the vendor. */
  platformFundedDiscountPaise: Paise;
  /** The vendor's GST value of supply (see PricingLineBreakdown.supplyTaxablePaise). */
  supplyTaxablePaise: Paise;
  /** GST on the supply value: the vendor's invoice, TCS and 194-O use it. */
  supplyTax: TaxBreakdownPaise;
  /** GST on the platform's share of the coupon, which the platform pays (supply GST − customer GST). */
  platformGstSubsidyPaise: Paise;
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
  /** Outbound shipping already refunded on this sub-order's earlier returns (paise). */
  shippingRefundedPaise?: Paise;
  /**
   * The sub-order's goods value (taxable) still standing before this return. A
   * seller-fault return refunds the shipping not yet refunded in proportion to the goods
   * value it returns out of this, so the last return refunds the rest. Omitted: all of it.
   */
  standingTaxablePaise?: Paise;
  /** The return fee is charged once per sub-order (parcel): true when already charged. */
  returnFeeAlreadyCharged?: boolean;
};

export type RefundReversalBreakdown = {
  refundSubtotalPaise: Paise;
  refundDiscountPaise: Paise;
  refundMerchandisePaise: Paise;
  refundTaxPaise: Paise;
  /** The supply value and its GST reversed (the vendor's credit note). */
  refundSupplyTaxablePaise: Paise;
  refundSupplyTaxPaise: Paise;
  refundCommissionPaise: Paise;
  refundTcsPaise: Paise;
  refundNetClawbackPaise: Paise;
  shippingRefundPaise: Paise;
  returnShippingFeePaise: Paise;
  /** Amount credited to customer (merchandise + tax ± shipping). */
  customerRefundPaise: Paise;
};

/** Splits an already-computed tax/TCS total into CGST+SGST (intra-state) or IGST (inter-state). */
export function splitTaxAmount(
  totalPaise: Paise,
  intraState: boolean,
): { cgst: Paise; sgst: Paise; igst: Paise } {
  if (intraState) {
    const half = Math.floor(totalPaise / 2);
    const other = totalPaise - half;
    return { cgst: half, sgst: other, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: totalPaise };
}

/**
 * GST on a taxable value, in paise. Intra-state, CGST and SGST are each charged at half
 * the rate and rounded on their own, so they are always equal (as on a GST invoice) and
 * the total is their sum; inter-state, IGST at the full rate. A negative taxable value
 * (a credit) gives the same amounts, negative.
 */
export function gstOnTaxablePaise(
  taxablePaise: Paise,
  gstPercentage: number,
  intraState: boolean,
): { cgst: Paise; sgst: Paise; igst: Paise; total: Paise } {
  const sign = taxablePaise < 0 ? -1 : 1;
  const base = Math.abs(taxablePaise);
  if (base === 0 || !(gstPercentage > 0)) return { cgst: 0, sgst: 0, igst: 0, total: 0 };
  if (intraState) {
    const half = sign * Math.round((base * gstPercentage) / 200);
    return { cgst: half, sgst: half, igst: 0, total: 2 * half };
  }
  const igst = sign * Math.round((base * gstPercentage) / 100);
  return { cgst: 0, sgst: 0, igst, total: igst };
}

function splitTax(taxablePaise: Paise, gstPercentage: number, intraState: boolean): TaxBreakdownPaise {
  return { ...gstOnTaxablePaise(taxablePaise, gstPercentage, intraState), gstPercentage };
}

/**
 * A line's vendor net: its supply value (taxable + the platform-funded part of its
 * discount) + GST on it − commission − TCS, never below zero. A coupon the platform
 * funds is the platform's cost, so the vendor is paid as if it had not been given —
 * the coupon share and the GST on it.
 */
function lineNetPayoutPaise(line: {
  supplyTaxablePaise: Paise;
  supplyTax: { total: Paise };
  commissionPaise: Paise;
  tcsPaise: Paise;
}): Paise {
  return Math.max(0, line.supplyTaxablePaise + line.supplyTax.total - line.commissionPaise - line.tcsPaise);
}

/**
 * When every line shares one GST rate, move the rounding residual of the per-line tax
 * onto the largest line so the lines add up to the tax on the whole (`pick` selects
 * customer or supply tax). Returns the residual applied.
 */
function reconcileSameRateTax(
  lines: PricingLineBreakdown[],
  pick: (line: PricingLineBreakdown) => TaxBreakdownPaise,
  baseOf: (line: PricingLineBreakdown) => Paise,
  intraState: boolean,
): Paise {
  const rates = [...new Set(lines.map((line) => pick(line).gstPercentage))];
  if (rates.length !== 1 || lines.length === 0) return 0;
  const base = lines.reduce((sum, line) => sum + baseOf(line), 0);
  const expected = splitTax(base, rates[0]!, intraState).total;
  const residual = expected - lines.reduce((sum, line) => sum + pick(line).total, 0);
  if (residual === 0) return 0;
  const target = lines.reduce((best, line) => (baseOf(line) > baseOf(best) ? line : best));
  const tax = pick(target);
  tax.total += residual;
  if (intraState) {
    // Both sides are sums of equal halves, so the residual is even: keep CGST = SGST.
    tax.cgst += residual / 2;
    tax.sgst += residual / 2;
  } else {
    tax.igst += residual;
  }
  return residual;
}

/**
 * Authoritative per-SubOrder pricing. All money in paise.
 * Order: line subtotals → merchandise discount → tax on post-discount (per-line GST) →
 * commission per-line (excludes tax/shipping) → TCS → net payout.
 *
 * Net payout is what the vendor is owed: the taxable value plus the GST the customer paid
 * on it (the vendor is the supplier on the tax invoice and remits that GST), plus the
 * platform-funded part of any coupon (the platform's promotion, which it pays for), less
 * commission and TCS. Shipping stays with the platform.
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
      gstPriceBand: line.gstPriceBand ?? null,
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
    const lineVendorBorne =
      merchandiseDiscountPaise > 0
        ? Math.round((discountPaise * vendorBorne) / merchandiseDiscountPaise)
        : 0;
    const platformFunded = Math.max(0, discountPaise - lineVendorBorne);
    // The vendor's value of supply: the platform's coupon share is paid to the vendor,
    // so it stays in the value GST is charged on (s.15 CGST Act).
    const supplyTaxable = lineTaxable + platformFunded;
    // The rate is decided by each piece's value of supply, so the vendor's own discount
    // can move a piece into the lower band (the platform's coupon does not).
    const lineGst = gstRateForPieces(line.gstPercentage, line.gstPriceBand, supplyTaxable, line.quantity);
    const lineTax = splitTax(lineTaxable, lineGst, input.intraState);
    const supplyTax = splitTax(supplyTaxable, lineGst, input.intraState);
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
      platformFundedDiscountPaise: platformFunded,
      supplyTaxablePaise: supplyTaxable,
      supplyTax,
      netPayoutPaise: 0,
    };
  });

  // TCS under section 52 is collected as CGST + SGST (or IGST) like GST: equal halves,
  // on the net value of taxable supplies — a nil-rated (0% GST) line carries none.
  const tcsBases = pricedLines.map((line) => (line.tax.gstPercentage > 0 ? line.supplyTaxablePaise : 0));
  const tcsBasePaise = tcsBases.reduce((sum, base) => sum + base, 0);
  const tcsPaise = gstOnTaxablePaise(tcsBasePaise, Number(input.tcsRatePercent || 0), input.intraState).total;
  const lineTcs = allocateProportionally(tcsPaise, tcsBases);
  for (let i = 0; i < pricedLines.length; i += 1) {
    const line = pricedLines[i]!;
    line.tcsPaise = lineTcs[i] ?? 0;
    line.netPayoutPaise = lineNetPayoutPaise(line);
  }

  // Lines sharing one GST rate add up to the tax on the whole (customer and supply alike).
  const appliedRoundingAdjustmentPaise = reconcileSameRateTax(
    pricedLines,
    (line) => line.tax,
    (line) => line.taxablePaise,
    input.intraState,
  );
  reconcileSameRateTax(pricedLines, (line) => line.supplyTax, (line) => line.supplyTaxablePaise, input.intraState);
  for (const line of pricedLines) line.netPayoutPaise = lineNetPayoutPaise(line);
  const sumTax = (pick: (line: PricingLineBreakdown) => TaxBreakdownPaise) => ({
    cgst: pricedLines.reduce((sum, line) => sum + pick(line).cgst, 0),
    sgst: pricedLines.reduce((sum, line) => sum + pick(line).sgst, 0),
    igst: pricedLines.reduce((sum, line) => sum + pick(line).igst, 0),
    total: pricedLines.reduce((sum, line) => sum + pick(line).total, 0),
  });
  const customerTax = sumTax((line) => line.tax);
  const supplyTaxTotals = sumTax((line) => line.supplyTax);
  const uniqueGst = [...new Set(pricedLines.map((line) => line.tax.gstPercentage))];
  const taxTotal = customerTax.total;

  const commissionBasePaise = pricedLines.reduce((sum, line) => sum + line.commissionBasePaise, 0);
  const commissionPaise = pricedLines.reduce((sum, line) => sum + line.commissionPaise, 0);
  const platformFundedDiscountPaise = pricedLines.reduce(
    (sum, line) => sum + line.platformFundedDiscountPaise,
    0,
  );
  const supplyTaxablePaise = pricedLines.reduce((sum, line) => sum + line.supplyTaxablePaise, 0);
  const netPayoutPaise = Math.max(
    0,
    supplyTaxablePaise + supplyTaxTotals.total - commissionPaise - tcsPaise,
  );
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
      cgst: customerTax.cgst,
      sgst: customerTax.sgst,
      igst: customerTax.igst,
      total: taxTotal,
      gstPercentage: displayGst,
    },
    commissionBasePaise,
    commissionPaise,
    tcsPaise,
    platformFundedDiscountPaise,
    supplyTaxablePaise,
    supplyTax: { ...supplyTaxTotals, gstPercentage: displayGst },
    platformGstSubsidyPaise: supplyTaxTotals.total - taxTotal,
    netPayoutPaise,
    customerTotalPaise,
    roundingAdjustmentPaise: appliedRoundingAdjustmentPaise,
  };
}

/**
 * The outbound shipping a seller-fault return refunds: the shipping not yet refunded, in
 * proportion to the goods value returned out of the goods still standing (all of it when
 * the return takes the rest, or when the standing value is not given).
 */
function proRataShippingRefundPaise(
  shippingChargedPaise: Paise | undefined,
  shippingRefundedPaise: Paise | undefined,
  returnedTaxablePaise: Paise,
  standingTaxablePaise: Paise | undefined,
): Paise {
  const remaining = Math.max(
    0,
    Math.round(shippingChargedPaise ?? 0) - Math.max(0, Math.round(shippingRefundedPaise ?? 0)),
  );
  if (remaining === 0) return 0;
  const standing = standingTaxablePaise == null ? null : Math.max(0, Math.round(standingTaxablePaise));
  if (standing == null || standing <= returnedTaxablePaise) return remaining;
  return Math.min(remaining, Math.round((remaining * Math.max(0, returnedTaxablePaise)) / standing));
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
      refundSupplyTaxablePaise: 0,
      refundSupplyTaxPaise: 0,
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
  // Intra-state tax is two equal halves (CGST = SGST): refund a part as equal halves too,
  // so its credit note's CGST equals its SGST. A full return refunds the tax as charged.
  const intraStateTax = line.tax.igst <= 0;
  const refundTaxPaise =
    qty === line.quantity || !intraStateTax
      ? scale(line.tax.total)
      : 2 * Math.round((line.tax.total * ratioNum) / (2 * ratioDen));
  // The vendor's credit note reverses the supply value and its GST (equal halves too).
  const supplyTax = line.supplyTax ?? line.tax;
  const supplyTaxable = line.supplyTaxablePaise ?? line.taxablePaise;
  const refundSupplyTaxablePaise = scale(supplyTaxable);
  const refundSupplyTaxPaise =
    qty === line.quantity || !intraStateTax
      ? scale(supplyTax.total)
      : 2 * Math.round((supplyTax.total * ratioNum) / (2 * ratioDen));
  const refundCommissionPaise = scale(line.commissionPaise);
  const refundTcsPaise = scale(line.tcsPaise);
  const refundNetClawbackPaise = scale(line.netPayoutPaise);

  let shippingRefundPaise = 0;
  let returnShippingFeePaise = 0;
  if (input.reasonCode) {
    const policy = resolveShippingRefundPolicy(input.reasonCode);
    if (policy.refundOriginalShipping) {
      shippingRefundPaise = proRataShippingRefundPaise(
        input.shippingChargedPaise,
        input.shippingRefundedPaise,
        refundMerchandisePaise,
        input.standingTaxablePaise,
      );
    }
    if (policy.deductReturnShippingFee && !input.returnFeeAlreadyCharged) {
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
    refundSupplyTaxablePaise,
    refundSupplyTaxPaise,
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
