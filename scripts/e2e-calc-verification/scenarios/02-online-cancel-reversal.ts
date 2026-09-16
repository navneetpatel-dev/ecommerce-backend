import { get, post, loginAs } from '../lib/httpClient';
import { ensureAddress, clearCart, addToCart, checkout, getOrder, pollOrderPaymentStatus } from '../lib/orderFlow';
import { assertClose, assertEqual, assertTrue, check } from '../lib/assert';
import { recomputeSubOrder } from '../lib/pricingRecompute';
import { runReport, findRowBy } from '../lib/reportClient';
import { postPaymentCaptured, postRefundProcessed } from '../lib/razorpayWebhook';
import { CUSTOMERS, CUSTOMER_PASSWORD, PRODUCTS, VENDORS } from '../lib/testData';
import type { Preconditions } from './00-preconditions';

const SCENARIO = '02-online-cancel';

function reportWindow(testRunStartedAt: string) {
  return { from: testRunStartedAt, to: new Date(Date.now() + 60_000).toISOString() };
}

export async function runOnlineCancelReversal(ctx: Preconditions) {
  console.log('\n--- 02: Online (Razorpay) order, then cancel a paid order ---');

  const customerToken = await loginAs(CUSTOMERS.onlineCancel, CUSTOMER_PASSWORD);
  const address = await ensureAddress(customerToken, VENDORS.fashionhub.state); // intra-state for this vendor
  const product = PRODUCTS.audioElite10;
  const quantity = 1;
  await clearCart(customerToken);
  await addToCart(customerToken, product.variantId, quantity);

  const { status: checkoutStatus, data: checkoutData } = await checkout(customerToken, {
    shippingAddressId: address.id,
    paymentMethod: 'RAZORPAY',
    walletAmountToUse: 0,
  });
  assertEqual(SCENARIO, 'checkout succeeds', checkoutStatus, 201);
  const orderId: string = checkoutData.orderId;
  const razorpayOrderId: string = checkoutData.razorpayOrderId;
  assertTrue(SCENARIO, 'razorpayOrderId returned', Boolean(razorpayOrderId));

  const capturedRes = await postPaymentCaptured(razorpayOrderId);
  check(SCENARIO, 'payment.captured webhook accepted', capturedRes.status === 200, `status=${capturedRes.status} body=${JSON.stringify(capturedRes.json)}`);

  const paidOrder = await pollOrderPaymentStatus(customerToken, orderId, 'PAID');
  assertEqual(SCENARIO, 'order paymentStatus PAID after webhook', paidOrder?.paymentStatus, 'PAID');

  const subOrder = paidOrder.subOrders[0];
  const expected = recomputeSubOrder({
    lines: [
      {
        key: 'item',
        unitPrice: product.price,
        quantity,
        gstPercentage: product.gstPercentage,
        commissionRatePercent: VENDORS.fashionhub.commissionRatePercent,
      },
    ],
    merchandiseDiscount: 0,
    shippingCost: subOrder.shippingCost,
    shippingDiscount: subOrder.shippingDiscountAmount ?? 0,
    tcsRatePercent: ctx.tcsRatePercent,
    intraState: true,
  });
  assertClose(SCENARIO, 'sub-order taxAmount matches recompute', subOrder.taxAmount, expected.taxTotal);

  // ---- Before snapshot ----
  const vendorToken = await loginAs(VENDORS.fashionhub.email, CUSTOMER_PASSWORD);
  const { status: commissionsStatusBefore, json: commissionsBefore } = await get('/api/commissions', vendorToken);
  const beforeRow = (commissionsBefore?.data?.rows ?? commissionsBefore?.data ?? []).find(
    (r: any) => r.subOrderId === subOrder.id,
  );
  check(SCENARIO, 'commission ledger row exists before cancel', commissionsStatusBefore === 200 && Boolean(beforeRow));

  // ---- Cancel the paid order ----
  const { status: cancelStatus, json: cancelJson } = await post(`/api/orders/${orderId}/cancel`, {}, customerToken);
  check(SCENARIO, 'cancel paid order', cancelStatus === 200, `status=${cancelStatus} body=${JSON.stringify(cancelJson).slice(0, 300)}`);

  const cancelledOrder = await getOrder(customerToken, orderId).then((r) => r.data);
  assertEqual(SCENARIO, 'order status CANCELLED', cancelledOrder.status, 'CANCELLED');
  // The captured payment above is a synthetic id (self-signed webhook only writes DB state,
  // it never creates a real Razorpay payment object) — so the real razorpay.payments.refund()
  // call cancellation triggers is *expected* to fail against Razorpay's actual test-mode API
  // with a real "payment not found" error. This is an inherent limitation of testing the
  // refund-initiation call this way, not an application defect — the DB-side reversal
  // (commission/TCS ledger deletion, restock, coupon/wallet rollback) is what's actually being
  // verified here, and that all happens inside the transaction before this real API call.
  assertEqual(SCENARIO, 'cancelRefundStatus FAILED (expected: synthetic payment id has no real Razorpay counterpart to refund)', cancelledOrder.cancelRefundStatus, 'FAILED');

  // Commission/TCS ledger rows for this sub-order should be gone.
  const { json: commissionsAfterCancel } = await get('/api/commissions', vendorToken);
  const afterRow = (commissionsAfterCancel?.data?.rows ?? commissionsAfterCancel?.data ?? []).find(
    (r: any) => r.subOrderId === subOrder.id,
  );
  assertTrue(SCENARIO, 'commission ledger row removed after cancel', !afterRow);

  // ---- Finalize refund via simulated webhook ----
  // handleRefundWebhook's ORDER_CANCEL branch only checks notes.orderId + notes.reason —
  // payment_id/amount aren't cross-checked against the order for that branch, so placeholders
  // are fine here (this mirrors what a real Razorpay refund.processed event would carry).
  const refundRes = await postRefundProcessed(
    `rfnd_test_${Date.now()}`,
    `pay_test_${razorpayOrderId}`,
    Math.round(cancelledOrder.totalAmount * 100),
    orderId,
  );
  check(SCENARIO, 'refund.processed webhook accepted', refundRes.status === 200, `status=${refundRes.status} body=${JSON.stringify(refundRes.json)}`);

  const refundedOrder = await getOrder(customerToken, orderId).then((r) => r.data);
  assertEqual(SCENARIO, 'paymentStatus REFUNDED after refund webhook', refundedOrder.paymentStatus, 'REFUNDED');
  assertEqual(SCENARIO, 'cancelRefundStatus COMPLETED', refundedOrder.cancelRefundStatus, 'COMPLETED');

  // ---- After snapshot ----
  const winAfter = reportWindow(ctx.testRunStartedAt);
  // tax-invoice-register filters only by taxInvoiceNumber + issuance date, not payment/order
  // status (confirmed via source: reportGaps.ts's taxInvoiceRegister query) — correctly, a
  // cancelled order's invoice stays on the register (paired with a credit note in a real GST
  // workflow); it must NOT disappear. This is the deliberately-verified correct behavior.
  const taxInvoiceReg = await runReport(ctx.adminToken, 'tax-invoice-register', winAfter);
  const stillPresent = findRowBy(taxInvoiceReg.rows ?? [], (r: any) => r.subOrderId === subOrder.id);
  assertTrue(SCENARIO, 'order remains in tax-invoice-register after cancellation (invoice record is never erased)', Boolean(stillPresent));

  // reconciliation/gst-tcs-summary DO use REPORTABLE_ORDER_SQL (paymentStatus='PAID' only, no
  // CANCELLED carve-out) — so this order (now REFUNDED) correctly drops out of the "money
  // actually collected" reconciliation view, while still being remembered as issued above.
  const reconAfter = await runReport(ctx.adminToken, 'reconciliation', winAfter);
  const reconAfterRow = Array.isArray(reconAfter.rows) ? reconAfter.rows[0] : reconAfter.meta ?? reconAfter.raw?.data;
  if (reconAfterRow) {
    assertEqual(SCENARIO, 'reconciliation still BALANCED after cancel+refund', reconAfterRow.status, 'BALANCED');
    assertClose(SCENARIO, 'reconciliation difference still 0 after cancel+refund', Number(reconAfterRow.difference ?? 0), 0, 0.02);
  }
}
