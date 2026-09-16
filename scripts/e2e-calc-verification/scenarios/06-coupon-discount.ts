import { loginAs } from '../lib/httpClient';
import { ensureAddress, clearCart, addToCart, checkout, getOrder } from '../lib/orderFlow';
import { assertClose, assertEqual, assertTrue, check } from '../lib/assert';
import { runReport } from '../lib/reportClient';
import { CUSTOMERS, CUSTOMER_PASSWORD, PRODUCTS, VENDORS, COUPONS } from '../lib/testData';
import type { Preconditions } from './00-preconditions';

const SCENARIO = '06-coupon';

export async function runCouponDiscount(ctx: Preconditions) {
  console.log('\n--- 06: Coupon discount reconciliation ---');

  const customerToken = await loginAs(CUSTOMERS.coupon, CUSTOMER_PASSWORD);
  const address = await ensureAddress(customerToken, VENDORS.techworld.state);
  const product = PRODUCTS.decorPro7; // well above the coupon's ₹100 minOrderValue
  const quantity = 1;
  await clearCart(customerToken);
  await addToCart(customerToken, product.variantId, quantity);

  const { status: checkoutStatus, data: checkoutData } = await checkout(customerToken, {
    shippingAddressId: address.id,
    paymentMethod: 'COD',
    couponCode: COUPONS.platformPercent,
  });
  assertEqual(SCENARIO, 'checkout with coupon succeeds', checkoutStatus, 201);
  const orderId: string = checkoutData.orderId;

  const { data: order } = await getOrder(customerToken, orderId);
  const merchandiseSubtotalBeforeDiscount = product.price * quantity;
  const expectedDiscount = Math.min(merchandiseSubtotalBeforeDiscount * 0.1, 500);
  assertClose(SCENARIO, 'discountTotal = min(10% of subtotal, cap 500)', order.discountTotal, expectedDiscount);

  const subOrder = order.subOrders[0];
  // Platform-borne coupon: vendor absorbs none of the discount, so commissionBase stays the
  // FULL (undiscounted) line subtotal — commission should be noticeably higher, relative to
  // taxable, than a vendor-borne discount would produce.
  const expectedCommissionOnFullSubtotal = Math.round(
    merchandiseSubtotalBeforeDiscount * (VENDORS.techworld.commissionRatePercent / 100) * 100,
  ) / 100;
  assertClose(
    SCENARIO,
    'commission computed on full (undiscounted) subtotal — platform absorbs the discount',
    subOrder.commissionAmount,
    expectedCommissionOnFullSubtotal,
  );

  const win = { from: ctx.testRunStartedAt, to: new Date(Date.now() + 60_000).toISOString() };
  const recon = await runReport(ctx.adminToken, 'reconciliation', win);
  const reconRow = Array.isArray(recon.rows) ? recon.rows[0] : recon.meta ?? recon.raw?.data;
  check(SCENARIO, 'reconciliation reachable', recon.status === 200);
  if (reconRow) {
    assertEqual(SCENARIO, 'reconciliation BALANCED with discounted taxable base', reconRow.status, 'BALANCED');
    assertClose(SCENARIO, 'reconciliation difference is 0', Number(reconRow.difference ?? 0), 0, 0.02);
  }

  const couponCost = await runReport(ctx.adminToken, 'coupon-discount-cost', win);
  check(SCENARIO, 'coupon-discount-cost reachable', couponCost.status === 200, `status=${couponCost.status} rows=${couponCost.rows?.length}`);
  const platformRow = (couponCost.rows ?? []).find((r: any) => r.discountBearer === 'PLATFORM' || r.groupKey === 'PLATFORM');
  assertTrue(SCENARIO, 'coupon-discount-cost has a PLATFORM-borne row', Boolean(platformRow));
}
