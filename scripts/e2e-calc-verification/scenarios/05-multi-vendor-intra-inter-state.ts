import { loginAs } from '../lib/httpClient';
import { ensureAddress, clearCart, addToCart, checkout, getOrder } from '../lib/orderFlow';
import { assertClose, assertEqual, assertTrue } from '../lib/assert';
import { recomputeSubOrder } from '../lib/pricingRecompute';
import { runReport } from '../lib/reportClient';
import { CUSTOMERS, CUSTOMER_PASSWORD, PRODUCTS, VENDORS } from '../lib/testData';
import type { Preconditions } from './00-preconditions';

const SCENARIO = '05-multi-vendor';

export async function runMultiVendorIntraInterState(ctx: Preconditions) {
  console.log('\n--- 05: Multi-vendor cart, intra-state + inter-state in one order ---');

  const customerToken = await loginAs(CUSTOMERS.multiVendor, CUSTOMER_PASSWORD);
  // Delhi address: intra-state for HomeStyle (Delhi vendor), inter-state for TechWorld (Karnataka).
  const address = await ensureAddress(customerToken, VENDORS.homestyle.state);
  assertEqual(SCENARIO, 'address matches HomeStyle state (Delhi)', address.state, VENDORS.homestyle.state);
  assertTrue(SCENARIO, 'address differs from TechWorld state', address.state !== VENDORS.techworld.state);

  const productA = PRODUCTS.audioClassic16; // HomeStyle, Delhi — intra-state leg
  const productB = PRODUCTS.decorPro7; // TechWorld, Karnataka — inter-state leg
  await clearCart(customerToken);
  await addToCart(customerToken, productA.variantId, 1);
  await addToCart(customerToken, productB.variantId, 1);

  const { status: checkoutStatus, data: checkoutData } = await checkout(customerToken, {
    shippingAddressId: address.id,
    paymentMethod: 'COD',
    walletAmountToUse: 0,
  });
  assertEqual(SCENARIO, 'checkout succeeds', checkoutStatus, 201);
  const orderId: string = checkoutData.orderId;

  const { data: order } = await getOrder(customerToken, orderId);
  assertEqual(SCENARIO, 'exactly 2 sub-orders (one per vendor)', order.subOrders.length, 2);

  const subA = order.subOrders.find((s: any) => s.vendorId === VENDORS.homestyle.id);
  const subB = order.subOrders.find((s: any) => s.vendorId === VENDORS.techworld.id);
  assertTrue(SCENARIO, 'HomeStyle sub-order present', Boolean(subA));
  assertTrue(SCENARIO, 'TechWorld sub-order present', Boolean(subB));

  if (subA) {
    const expectedA = recomputeSubOrder({
      lines: [{ key: 'a', unitPrice: productA.price, quantity: 1, gstPercentage: productA.gstPercentage, commissionRatePercent: VENDORS.homestyle.commissionRatePercent }],
      merchandiseDiscount: 0,
      shippingCost: subA.shippingCost,
      shippingDiscount: subA.shippingDiscountAmount ?? 0,
      tcsRatePercent: ctx.tcsRatePercent,
      intraState: true,
    });
    assertEqual(SCENARIO, 'HomeStyle sub-order taxDisplayKey CGST_SGST (intra-state)', subA.taxDisplayKey, 'CGST_SGST');
    assertClose(SCENARIO, 'HomeStyle sub-order taxAmount matches recompute (intra-state)', subA.taxAmount, expectedA.taxTotal);
    assertClose(SCENARIO, 'HomeStyle sub-order commissionAmount matches recompute', subA.commissionAmount, expectedA.commissionTotal);
  }

  if (subB) {
    const expectedB = recomputeSubOrder({
      lines: [{ key: 'b', unitPrice: productB.price, quantity: 1, gstPercentage: productB.gstPercentage, commissionRatePercent: VENDORS.techworld.commissionRatePercent }],
      merchandiseDiscount: 0,
      shippingCost: subB.shippingCost,
      shippingDiscount: subB.shippingDiscountAmount ?? 0,
      tcsRatePercent: ctx.tcsRatePercent,
      intraState: false,
    });
    assertEqual(SCENARIO, 'TechWorld sub-order taxDisplayKey IGST (inter-state)', subB.taxDisplayKey, 'IGST');
    assertClose(SCENARIO, 'TechWorld sub-order taxAmount matches recompute (inter-state)', subB.taxAmount, expectedB.taxTotal);
    assertClose(SCENARIO, 'TechWorld sub-order commissionAmount matches recompute', subB.commissionAmount, expectedB.commissionTotal);
  }

  if (subA && subB) {
    assertClose(
      SCENARIO,
      'order merchandiseSubtotal = sum of both sub-order subtotals (no cross-vendor leakage)',
      order.merchandiseSubtotal,
      subA.subtotal + subB.subtotal,
    );
    assertClose(
      SCENARIO,
      'order taxTotal = sum of both sub-order tax amounts',
      order.taxTotal,
      subA.taxAmount + subB.taxAmount,
    );
  }

  // state-tax-collection groups by SHIPPING state, so both vendors' tax lands in one row
  // (HomeStyle's CGST+SGST and TechWorld's IGST both attributed to the shipping state).
  const win = { from: ctx.testRunStartedAt, to: new Date(Date.now() + 60_000).toISOString() };
  const stateTax = await runReport(ctx.adminToken, 'state-tax-collection', win);
  const stateRow = (stateTax.rows ?? []).find((r: any) => r.state === address.state);
  assertTrue(SCENARIO, 'state-tax-collection has a row for the shipping state', Boolean(stateRow));
  if (stateRow && subA && subB) {
    const cgstSgst = Number(stateRow.cgst ?? 0) + Number(stateRow.sgst ?? 0);
    assertTrue(SCENARIO, 'state row cgst+sgst includes HomeStyle tax', cgstSgst >= subA.taxAmount - 0.02);
    assertTrue(SCENARIO, 'state row igst includes TechWorld tax', Number(stateRow.igst ?? 0) >= subB.taxAmount - 0.02);
  }
}
