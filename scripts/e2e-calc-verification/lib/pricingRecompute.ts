import { toPaise, fromPaise, allocateProportionally, splitTaxAmount } from './money';

export type RecomputeLineInput = {
  key: string;
  unitPrice: number; // rupees
  quantity: number;
  gstPercentage: number;
  commissionRatePercent: number;
};

export type RecomputeInput = {
  lines: RecomputeLineInput[];
  merchandiseDiscount: number; // rupees, total across the sub-order
  vendorBorneDiscount?: number; // rupees, portion of discount absorbed by vendor (0 if platform-borne)
  shippingCost: number;
  shippingDiscount: number;
  tcsRatePercent: number;
  intraState: boolean;
};

export type RecomputeLineOutput = {
  key: string;
  lineSubtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  commission: number;
};

export type RecomputeOutput = {
  lines: RecomputeLineOutput[];
  subtotal: number;
  taxableTotal: number;
  taxTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  commissionTotal: number;
  tcsTotal: number;
  netPayout: number;
  shippingCharged: number;
  customerTotal: number;
};

/** Pure-JS reimplementation of pricing.engine.ts's computeSubOrderBreakdown, in rupees in/out (paise internally). */
export function recomputeSubOrder(input: RecomputeInput): RecomputeOutput {
  const lines = input.lines.map((l) => ({
    key: l.key,
    unitPricePaise: toPaise(l.unitPrice),
    quantity: Math.max(0, Math.floor(l.quantity)),
    gstPercentage: l.gstPercentage,
    commissionRatePercent: l.commissionRatePercent,
  }));
  const lineSubtotalPaise = lines.map((l) => l.unitPricePaise * l.quantity);
  const subtotalPaise = lineSubtotalPaise.reduce((a, b) => a + b, 0);

  const merchandiseDiscountPaise = Math.min(toPaise(input.merchandiseDiscount), subtotalPaise);
  const shippingCostPaise = toPaise(input.shippingCost);
  const shippingDiscountPaise = Math.min(toPaise(input.shippingDiscount), shippingCostPaise);
  const shippingChargedPaise = shippingCostPaise - shippingDiscountPaise;

  const lineDiscounts = allocateProportionally(merchandiseDiscountPaise, lineSubtotalPaise);

  const vendorBornePaise = Math.min(
    merchandiseDiscountPaise,
    toPaise(input.vendorBorneDiscount ?? 0),
  );

  const taxablePaise = lines.map((_, i) => Math.max(0, lineSubtotalPaise[i]! - lineDiscounts[i]!));
  const taxableTotalPaise = taxablePaise.reduce((a, b) => a + b, 0);

  let platformFundedPaise = 0;
  const lineOutputs: RecomputeLineOutput[] = lines.map((l, i) => {
    const discountPaise = lineDiscounts[i] ?? 0;
    const lineTaxablePaise = taxablePaise[i]!;
    const taxTotalPaiseLine = Math.round((lineTaxablePaise * l.gstPercentage) / 100);
    const split = splitTaxAmount(taxTotalPaiseLine, input.intraState);
    const lineVendorBorne =
      merchandiseDiscountPaise > 0
        ? Math.round((discountPaise * vendorBornePaise) / merchandiseDiscountPaise)
        : 0;
    const commissionBasePaise = Math.max(0, lineSubtotalPaise[i]! - lineVendorBorne);
    platformFundedPaise += Math.max(0, discountPaise - lineVendorBorne);
    const commissionPaise = Math.round((commissionBasePaise * l.commissionRatePercent) / 100);
    return {
      key: l.key,
      lineSubtotal: fromPaise(lineSubtotalPaise[i]!),
      discount: fromPaise(discountPaise),
      taxable: fromPaise(lineTaxablePaise),
      tax: fromPaise(taxTotalPaiseLine),
      cgst: fromPaise(split.cgst),
      sgst: fromPaise(split.sgst),
      igst: fromPaise(split.igst),
      commission: fromPaise(commissionPaise),
    };
  });

  // Sub-order-level tax: recomputed directly from the sub-order taxable total (matches
  // pricing.engine.ts's rounding-reconciliation nudge when all lines share one GST rate).
  const uniqueGst = [...new Set(lines.map((l) => l.gstPercentage))];
  let taxTotalPaise: number;
  let cgstTotal: number;
  let sgstTotal: number;
  let igstTotal: number;
  if (uniqueGst.length === 1) {
    taxTotalPaise = Math.round((taxableTotalPaise * uniqueGst[0]!) / 100);
    const split = splitTaxAmount(taxTotalPaise, input.intraState);
    cgstTotal = split.cgst;
    sgstTotal = split.sgst;
    igstTotal = split.igst;
  } else {
    taxTotalPaise = lineOutputs.reduce((s, l) => s + toPaise(l.tax), 0);
    cgstTotal = lineOutputs.reduce((s, l) => s + toPaise(l.cgst), 0);
    sgstTotal = lineOutputs.reduce((s, l) => s + toPaise(l.sgst), 0);
    igstTotal = lineOutputs.reduce((s, l) => s + toPaise(l.igst), 0);
  }

  const commissionTotalPaise = lineOutputs.reduce((s, l) => s + toPaise(l.commission), 0);
  const tcsTotalPaise = Math.round((taxableTotalPaise * input.tcsRatePercent) / 100);
  // The vendor is the supplier and remits the GST, so its net includes the tax; the
  // platform pays the vendor the part of the coupon it funds.
  const netPayoutPaise = Math.max(
    0,
    taxableTotalPaise + platformFundedPaise + taxTotalPaise - commissionTotalPaise - tcsTotalPaise,
  );
  const customerTotalPaise = taxableTotalPaise + taxTotalPaise + shippingChargedPaise;

  return {
    lines: lineOutputs,
    subtotal: fromPaise(subtotalPaise),
    taxableTotal: fromPaise(taxableTotalPaise),
    taxTotal: fromPaise(taxTotalPaise),
    cgstTotal: fromPaise(cgstTotal),
    sgstTotal: fromPaise(sgstTotal),
    igstTotal: fromPaise(igstTotal),
    commissionTotal: fromPaise(commissionTotalPaise),
    tcsTotal: fromPaise(tcsTotalPaise),
    netPayout: fromPaise(netPayoutPaise),
    shippingCharged: fromPaise(shippingChargedPaise),
    customerTotal: fromPaise(customerTotalPaise),
  };
}
