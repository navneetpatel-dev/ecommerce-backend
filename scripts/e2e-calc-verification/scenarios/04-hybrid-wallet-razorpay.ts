import { get, post, loginAs } from '../lib/httpClient';
import { ensureAddress, clearCart, addToCart, checkout, getOrder, pollOrderPaymentStatus } from '../lib/orderFlow';
import { assertClose, assertEqual, assertTrue, check } from '../lib/assert';
import { recomputeSubOrder } from '../lib/pricingRecompute';
import { runReport, findRowBy } from '../lib/reportClient';
import { postPaymentCaptured } from '../lib/razorpayWebhook';
import { CUSTOMERS, CUSTOMER_PASSWORD, PRODUCTS, VENDORS } from '../lib/testData';
import type { Preconditions } from './00-preconditions';

const SCENARIO = '04-hybrid';

async function adminAdjustWallet(adminToken: string, userId: string, amount: number) {
  return post(
    `/api/admin/wallet/${userId}/adjust`,
    { direction: 'CREDIT', amount, reason: 'E2E hybrid test wallet seed', pointSource: 'PURCHASED' },
    adminToken,
  );
}

export async function runHybridWalletRazorpay(ctx: Preconditions) {
  console.log('\n--- 04: Hybrid wallet + Razorpay ---');

  const customerToken = await loginAs(CUSTOMERS.hybrid, CUSTOMER_PASSWORD);
  const userIdRes = await get('/api/users/me', customerToken);
  const userId: string = userIdRes.json?.data?.id;

  const WALLET_PORTION = 40;
  const adjust = await adminAdjustWallet(ctx.adminToken, userId, WALLET_PORTION);
  check(SCENARIO, 'admin wallet adjust succeeds', adjust.status === 200, `status=${adjust.status}`);

  const address = await ensureAddress(customerToken, VENDORS.fashionhub.state);
  const product = PRODUCTS.beddingElite24;
  const quantity = 1;
  await clearCart(customerToken);
  await addToCart(customerToken, product.variantId, quantity);

  const { status: checkoutStatus, data: checkoutData } = await checkout(customerToken, {
    shippingAddressId: address.id,
    paymentMethod: 'RAZORPAY',
    walletAmountToUse: WALLET_PORTION,
  });
  assertEqual(SCENARIO, 'checkout succeeds', checkoutStatus, 201);
  assertTrue(SCENARIO, 'razorpayOrderId returned (remainder due)', Boolean(checkoutData.razorpayOrderId));
  const orderId: string = checkoutData.orderId;
  const razorpayOrderId: string = checkoutData.razorpayOrderId;

  const { data: orderBeforeCapture } = await getOrder(customerToken, orderId);
  assertClose(SCENARIO, 'walletAmountUsed = 40 immediately', orderBeforeCapture.walletAmountUsed, WALLET_PORTION);
  assertEqual(SCENARIO, 'paymentStatus not yet PAID (Razorpay portion outstanding)', orderBeforeCapture.paymentStatus, 'PENDING');
  assertClose(
    SCENARIO,
    'amountDue = total - walletPortion',
    orderBeforeCapture.amountDue,
    orderBeforeCapture.totalAmount - WALLET_PORTION,
  );

  const capturedRes = await postPaymentCaptured(razorpayOrderId);
  check(SCENARIO, 'payment.captured webhook accepted', capturedRes.status === 200, `status=${capturedRes.status}`);

  const paidOrder = await pollOrderPaymentStatus(customerToken, orderId, 'PAID');
  assertEqual(SCENARIO, 'paymentStatus PAID after webhook', paidOrder?.paymentStatus, 'PAID');
  assertClose(
    SCENARIO,
    'razorpayAmountPaid + walletAmountUsed = totalAmount',
    Number(paidOrder.razorpayAmountPaid ?? 0) + Number(paidOrder.walletAmountUsed ?? 0),
    paidOrder.totalAmount,
  );

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
  assertClose(SCENARIO, 'sub-order commissionAmount matches recompute', subOrder.commissionAmount, expected.commissionTotal);

  const win = { from: ctx.testRunStartedAt, to: new Date(Date.now() + 60_000).toISOString() };
  const pgRecon = await runReport(ctx.adminToken, 'payment-gateway-reconciliation', win);
  check(
    SCENARIO,
    'payment-gateway-reconciliation reachable',
    pgRecon.status === 200,
    `status=${pgRecon.status} rows=${pgRecon.rows?.length}`,
  );
  const pgRow = findRowBy(pgRecon.rows ?? [], (r: any) => r.orderId === orderId);
  assertTrue(SCENARIO, 'payment-gateway-reconciliation includes this order', Boolean(pgRow));
}
