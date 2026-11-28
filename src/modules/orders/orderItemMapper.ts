import { alignUnitAndLine, coerceRupees, fromPaise, roundMoney, toPaise } from '@modules/pricing/money';
import { gstOnTaxablePaise } from '@modules/pricing/pricing.engine';
import { lineTotal, orderItemDisplayLineSubtotal } from '@modules/pricing/displayMoney';

/** Primary image for an order line, resolved live from the product catalogue. */
function orderItemImageUrl(item: Record<string, unknown>): string | null {
  const product = (item.variant as Record<string, unknown> | undefined)?.product as Record<string, unknown> | undefined;
  const images = (product?.images as Array<Record<string, unknown>> | undefined) ?? [];
  const primary = images.find((image) => image.isPrimary) ?? images[0];
  const url = primary?.url;
  return typeof url === 'string' && url ? url : null;
}

/**
 * An order line as the customer saw it when buying: the price per piece with GST, and
 * the line with GST before any coupon — at the rate the line was charged. A line with
 * no coupon share is exactly what was paid for it.
 */
function orderItemInclusive(item: Record<string, unknown>, unitPrice: number, quantity: number) {
  if (item.taxBreakdown == null) {
    // A fully returned line is zeroed (breakdown cleared): nothing of it is left on the bill.
    const zeroed =
      toPaise(roundMoney(item.lineSubtotal)) === 0 &&
      toPaise(roundMoney(item.taxableAmount)) === 0 &&
      toPaise(roundMoney(item.taxAmount)) === 0;
    if (zeroed) return { displayUnitPrice: null, lineDisplaySubtotal: 0, paidPaise: 0 };
    // Lines placed before per-line GST was recorded carry no breakdown: no figure, so the
    // page keeps its pre-GST one.
    return null;
  }
  const tax = item.taxBreakdown as { cgst?: unknown; sgst?: unknown; gstPercentage?: unknown };
  const rate = Number(tax.gstPercentage ?? 0);
  const intraState = coerceRupees(tax.cgst) > 0 || coerceRupees(tax.sgst) > 0;
  const paidPaise = toPaise(roundMoney(item.taxableAmount)) + toPaise(roundMoney(item.taxAmount));
  const grossPaise =
    toPaise(roundMoney(item.discountAmount)) <= 0
      ? paidPaise
      : (() => {
          const linePaise = toPaise(unitPrice) * quantity;
          return (
            linePaise +
            gstOnTaxablePaise(linePaise, Number.isFinite(rate) ? rate : 0, intraState).total
          );
        })();
  const aligned = alignUnitAndLine(grossPaise, quantity);
  return {
    displayUnitPrice: fromPaise(aligned.unitPricePaise),
    lineDisplaySubtotal: fromPaise(aligned.lineTotalPaise),
    paidPaise,
  };
}

export function mapOrderItem(item: Record<string, unknown>) {
  const unitPrice = roundMoney(item.unitPrice);
  const quantity = Math.trunc(coerceRupees(item.quantity)) || 0;
  const taxableAmount = roundMoney(item.taxableAmount);
  const taxAmount = roundMoney(item.taxAmount);
  const inclusive = orderItemInclusive(item, unitPrice, quantity);
  return {
    id: item.id,
    variantId: item.variantId,
    productName: item.productName,
    imageUrl: orderItemImageUrl(item),
    variantAttributes: ((item.variant as Record<string, unknown> | undefined)?.attributes as Record<string, string> | undefined) ?? null,
    productSlug: ((item.variant as Record<string, unknown> | undefined)?.product as Record<string, unknown> | undefined)?.slug ?? null,
    quantity,
    unitPrice,
    discountAmount: roundMoney(item.discountAmount),
    taxableAmount,
    taxAmount,
    commissionAmount: roundMoney(item.commissionAmount),
    tcsAmount: roundMoney(item.tcsAmount),
    netPayoutAmount: roundMoney(item.netPayoutAmount),
    lineSubtotal: orderItemDisplayLineSubtotal({
      unitPrice,
      quantity,
      taxableAmount,
      taxAmount,
      storedLineSubtotal: item.lineSubtotal,
    }),
    lineTotal: lineTotal(taxableAmount, taxAmount),
    /** Price per piece as the customer saw it, GST included (null for lines without a GST breakdown). */
    displayUnitPrice: inclusive?.displayUnitPrice ?? null,
    /** The line with GST, before any coupon. */
    lineDisplaySubtotal: inclusive?.lineDisplaySubtotal ?? null,
  };
}
