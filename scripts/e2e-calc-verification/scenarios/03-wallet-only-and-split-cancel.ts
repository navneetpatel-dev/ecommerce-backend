import { get, post, loginAs } from '../lib/httpClient';
import { ensureAddress, clearCart, addToCart, checkout, getOrder } from '../lib/orderFlow';
import { assertClose, assertEqual, assertTrue, check } from '../lib/assert';
import { recomputeSubOrder } from '../lib/pricingRecompute';
import { CUSTOMERS, CUSTOMER_PASSWORD, PRODUCTS, VENDORS } from '../lib/testData';
import type { Preconditions } from './00-preconditions';

const SCENARIO = '03-wallet-only';

async function getWalletBalance(token: string) {
  const { json } = await get('/api/wallet/balance', token);
  return json?.data;
}

async function adminAdjustWallet(
  adminToken: string,
  userId: string,
  amount: number,
  pointSource: 'PURCHASED' | 'PROMOTIONAL',
) {
  return post(
    `/api/admin/wallet/${userId}/adjust`,
    { direction: 'CREDIT', amount, reason: 'E2E test wallet seed', pointSource },
    adminToken,
  );
}

export async function runWalletOnlyAndSplitCancel(ctx: Preconditions) {
  console.log('\n--- 03: Wallet-only order + promotional/purchased split rollback ---');

  const customerToken = await loginAs(CUSTOMERS.walletOnly, CUSTOMER_PASSWORD);
  const userIdRes = await get('/api/users/me', customerToken);
  const userId: string = userIdRes.json?.data?.id;
  assertTrue(SCENARIO, 'resolved customer userId', Boolean(userId));

  // Baseline BEFORE seeding: this script is re-run repeatedly against the same seeded DB with
  // no teardown (see plan §"Key resolved risks"), and admin wallet-adjust credits accumulate
  // across runs (cancellation only reverses the checkout DEBIT, never the original admin
  // CREDIT) — so every assertion below compares against this run's own baseline delta, never
  // a hardcoded absolute balance.
  const baseline = await getWalletBalance(customerToken);
  const basePromo = Number(baseline?.promotionalBalance ?? 0);
  const basePurchased = Number(baseline?.purchasedBalance ?? 0);

  // Comfortably above jacketsElite48's real order total (price + tax + shipping, confirmed
  // ~454 live) so this is unambiguously a wallet-only payment, not an accidental hybrid.
  const PROMO_AMOUNT = 200;
  const PURCHASED_AMOUNT = 500;
  const adjustPromo = await adminAdjustWallet(ctx.adminToken, userId, PROMO_AMOUNT, 'PROMOTIONAL');
  check(SCENARIO, 'admin wallet adjust (promotional) succeeds', adjustPromo.status === 200, `status=${adjustPromo.status} body=${JSON.stringify(adjustPromo.json).slice(0, 200)}`);
  const adjustPurchased = await adminAdjustWallet(ctx.adminToken, userId, PURCHASED_AMOUNT, 'PURCHASED');
  check(SCENARIO, 'admin wallet adjust (purchased) succeeds', adjustPurchased.status === 200, `status=${adjustPurchased.status}`);

  const balanceBeforeOrder = await getWalletBalance(customerToken);
  assertClose(SCENARIO, 'wallet balance increased by exactly the seeded amount', Number(balanceBeforeOrder?.balance ?? 0) - Number(baseline?.balance ?? 0), PROMO_AMOUNT + PURCHASED_AMOUNT);
  assertClose(SCENARIO, 'promotionalBalance = baseline + 200', Number(balanceBeforeOrder?.promotionalBalance ?? 0), basePromo + PROMO_AMOUNT);
  assertClose(SCENARIO, 'purchasedBalance = baseline + 500', Number(balanceBeforeOrder?.purchasedBalance ?? 0), basePurchased + PURCHASED_AMOUNT);

  const address = await ensureAddress(customerToken, VENDORS.techworld.state);
  const product = PRODUCTS.jacketsElite48; // cheap item, comfortably below the 130 wallet balance
  const quantity = 1;
  await clearCart(customerToken);
  await addToCart(customerToken, product.variantId, quantity);

  // Wallet covers the full total — server clamps walletAmountToUse to the actual total.
  const { status: checkoutStatus, data: checkoutData } = await checkout(customerToken, {
    shippingAddressId: address.id,
    paymentMethod: 'RAZORPAY',
    walletAmountToUse: 999999,
  });
  assertEqual(SCENARIO, 'checkout succeeds (wallet-only, no Razorpay order)', checkoutStatus, 201);
  assertTrue(SCENARIO, 'no razorpayOrderId returned (fully wallet-paid)', !checkoutData.razorpayOrderId);
  const orderId: string = checkoutData.orderId;

  const { data: order } = await getOrder(customerToken, orderId);
  assertEqual(SCENARIO, 'order paymentStatus PAID immediately', order.paymentStatus, 'PAID');
  assertEqual(SCENARIO, 'order status CONFIRMED', order.status, 'CONFIRMED');
  assertClose(SCENARIO, 'walletAmountUsed = totalAmount', order.walletAmountUsed, order.totalAmount);
  assertEqual(SCENARIO, 'amountDue = 0', order.amountDue, 0);

  const subOrder = order.subOrders[0];
  const expected = recomputeSubOrder({
    lines: [
      {
        key: 'item',
        unitPrice: product.price,
        quantity,
        gstPercentage: product.gstPercentage,
        commissionRatePercent: VENDORS.techworld.commissionRatePercent,
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

  // Debit split: promotional is drawn down first, remainder from purchased. The newly-seeded
  // promotional pool (basePromo + PROMO_AMOUNT) is what's actually available at debit time.
  const balanceAfterOrder = await getWalletBalance(customerToken);
  const orderTotal = order.totalAmount;
  const seededPromo = basePromo + PROMO_AMOUNT;
  const seededPurchased = basePurchased + PURCHASED_AMOUNT;
  const expectedPromoLeft = Math.max(0, seededPromo - orderTotal);
  const expectedPurchasedLeft =
    orderTotal <= seededPromo ? seededPurchased : seededPurchased - (orderTotal - seededPromo);
  assertClose(SCENARIO, 'promotionalBalance drawn down first', Number(balanceAfterOrder?.promotionalBalance ?? 0), expectedPromoLeft);
  assertClose(SCENARIO, 'purchasedBalance covers the remainder', Number(balanceAfterOrder?.purchasedBalance ?? 0), expectedPurchasedLeft);

  // ---- Cancel this wallet-only order and verify the split rolls back exactly ----
  const { status: cancelStatus } = await post(`/api/orders/${orderId}/cancel`, {}, customerToken);
  assertEqual(SCENARIO, 'cancel wallet-only order succeeds', cancelStatus, 200);

  const cancelledOrder = await getOrder(customerToken, orderId).then((r) => r.data);
  assertEqual(SCENARIO, 'order status CANCELLED', cancelledOrder.status, 'CANCELLED');
  assertEqual(
    SCENARIO,
    'paymentStatus REFUNDED immediately (no gateway refund needed, wallet-only)',
    cancelledOrder.paymentStatus,
    'REFUNDED',
  );

  const balanceAfterCancel = await getWalletBalance(customerToken);
  assertClose(
    SCENARIO,
    'promotionalBalance restored to exactly its pre-checkout (seeded) value — split-preserving rollback',
    Number(balanceAfterCancel?.promotionalBalance ?? 0),
    seededPromo,
  );
  assertClose(
    SCENARIO,
    'purchasedBalance restored to exactly its pre-checkout (seeded) value — split-preserving rollback',
    Number(balanceAfterCancel?.purchasedBalance ?? 0),
    seededPurchased,
  );
}
