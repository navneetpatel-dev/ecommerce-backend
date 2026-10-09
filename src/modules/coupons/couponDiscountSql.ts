import { ORDER_STATUS, RETURN_STATUS } from '@core/constants/statuses';

/**
 * One coupon redemption's discount still given, in paise (aliases: `cu` = coupon_usages,
 * `c` = its coupon), net of what was taken back — as its "revenue impact" is net of
 * refunds. A cancelled or RTO'd (RETURNED) part was refunded, so the discount on it was
 * never given (the same parts `sqlOrderPaymentPaise` takes out of the payment), and a
 * return takes back the discount on the goods returned. The redemption keeps the share
 * of its discount that sits on goods still kept: the kept parts' discount now
 * (merchandise, reduced in place by returns, + shipping) over every part's at checkout
 * (now + what their refunded returns took back: returned value before discount less
 * after), or their merchandise likewise when the parts carry no discount. A vendor
 * coupon only discounted that vendor's parts, so only those count.
 */
export function sqlKeptCouponDiscountPaise(): string {
  const kept = `s."status" NOT IN ('${ORDER_STATUS.CANCELLED}', '${ORDER_STATUS.RETURNED}')`;
  const returned = (pick: string) => `COALESCE((
      SELECT SUM(${pick})
      FROM return_requests rr
      INNER JOIN order_items oi ON oi.id = rr."orderItemId"
      WHERE rr."subOrderId" = s.id
        AND rr."deletedAt" IS NULL
        AND rr.status <> '${RETURN_STATUS.REJECTED}'
        AND rr."refundMerchandiseAmountPaise" IS NOT NULL
    ), 0)`;
  const returnedDiscount = returned(`GREATEST(0, oi."unitPricePaise" * rr."returnQuantity" - rr."refundMerchandiseAmountPaise")`);
  const returnedSubtotal = returned(`oi."unitPricePaise" * rr."returnQuantity"`);
  return `ROUND(ROUND(cu."discountApplied"::numeric * 100) * COALESCE((
    SELECT CASE
      WHEN SUM(s."discountAmountPaise" + s."shippingDiscountAmountPaise" + ${returnedDiscount}) > 0
        THEN SUM(CASE WHEN ${kept} THEN s."discountAmountPaise" + s."shippingDiscountAmountPaise" ELSE 0 END)::numeric
          / SUM(s."discountAmountPaise" + s."shippingDiscountAmountPaise" + ${returnedDiscount})
      WHEN SUM(s."subtotalPaise" + ${returnedSubtotal}) > 0
        THEN SUM(CASE WHEN ${kept} THEN s."subtotalPaise" ELSE 0 END)::numeric
          / SUM(s."subtotalPaise" + ${returnedSubtotal})
      ELSE 1
    END
    FROM sub_orders s
    WHERE s."orderId" = cu."orderId"
      AND s."deletedAt" IS NULL
      AND (c."vendorId" IS NULL OR s."vendorId" = c."vendorId")
  ), 1))::bigint`;
}
