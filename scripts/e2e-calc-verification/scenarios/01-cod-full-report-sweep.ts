import { get, post, patch, loginAs } from '../lib/httpClient';
import { ensureAddress, clearCart, addToCart, checkout, getOrder } from '../lib/orderFlow';
import { assertClose, assertEqual, assertTrue, check } from '../lib/assert';
import { recomputeSubOrder } from '../lib/pricingRecompute';
import { runReport, findRowBy } from '../lib/reportClient';
import { pollDeliveryOtp } from '../lib/otpFromQueue';
import { CREDENTIALS, CUSTOMERS, CUSTOMER_PASSWORD, PRODUCTS, VENDORS } from '../lib/testData';
import type { Preconditions } from './00-preconditions';

const SCENARIO = '01-cod-sweep';

function reportWindow(testRunStartedAt: string) {
  const to = new Date(Date.now() + 60_000).toISOString();
  return { from: testRunStartedAt, to };
}

export async function runCodFullReportSweep(ctx: Preconditions) {
  console.log('\n--- 01: COD purchase + full 4-role report sweep ---');

  const customerToken = await loginAs(CUSTOMERS.codSweep, CUSTOMER_PASSWORD);
  const address = await ensureAddress(customerToken, VENDORS.techworld.state); // intra-state
  assertEqual(SCENARIO, 'address state matches vendor (intra-state)', address.state, VENDORS.techworld.state);

  const product = PRODUCTS.decorPro7;
  const quantity = 2;
  await clearCart(customerToken);
  await addToCart(customerToken, product.variantId, quantity);

  const { status: checkoutStatus, data: checkoutData } = await checkout(customerToken, {
    shippingAddressId: address.id,
    paymentMethod: 'COD',
    walletAmountToUse: 0,
  });
  assertEqual(SCENARIO, 'checkout succeeds', checkoutStatus, 201);
  const orderId: string = checkoutData.orderId;
  assertTrue(SCENARIO, 'orderId returned', Boolean(orderId));

  const { data: order } = await getOrder(customerToken, orderId);
  assertEqual(SCENARIO, 'order status CONFIRMED', order.status, 'CONFIRMED');
  assertEqual(SCENARIO, 'order paymentStatus PENDING (COD pre-delivery)', order.paymentStatus, 'PENDING');
  assertEqual(SCENARIO, 'order paymentMethod COD', order.paymentMethod, 'COD');

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

  assertClose(SCENARIO, 'sub-order taxableAmount', subOrder.taxableAmount, expected.taxableTotal);
  assertClose(SCENARIO, 'sub-order taxAmount', subOrder.taxAmount, expected.taxTotal);
  assertEqual(SCENARIO, 'sub-order taxDisplayKey is CGST_SGST (intra-state)', subOrder.taxDisplayKey, 'CGST_SGST');
  assertClose(SCENARIO, 'sub-order commissionAmount', subOrder.commissionAmount, expected.commissionTotal);
  assertClose(SCENARIO, 'sub-order tcsAmount', subOrder.tcsAmount, expected.tcsTotal);
  assertClose(SCENARIO, 'sub-order netPayoutAmount', subOrder.netPayoutAmount, expected.netPayout);
  assertClose(SCENARIO, 'sub-order customerTotal', subOrder.customerTotal, expected.customerTotal);
  assertClose(
    SCENARIO,
    'order totalAmount = merchandiseSubtotal + taxTotal + shippingTotal',
    order.totalAmount,
    order.merchandiseSubtotal + order.taxTotal + order.shippingTotal,
  );
  assertTrue(SCENARIO, 'taxInvoiceNumber allocated at order creation', Boolean(subOrder.taxInvoiceNumber));

  // ---- Admin report sweep (order is already reportable: COD + not FAILED/REFUNDED + not CANCELLED) ----
  const win = reportWindow(ctx.testRunStartedAt);
  const recon = await runReport(ctx.adminToken, 'reconciliation', win);
  const reconRow = Array.isArray(recon.rows) ? recon.rows[0] : recon.meta ?? recon.raw?.data;
  check(SCENARIO, 'reconciliation report reachable', recon.status === 200, `status=${recon.status}`);
  if (reconRow) {
    assertEqual(SCENARIO, 'reconciliation status BALANCED', reconRow.status, 'BALANCED');
    assertClose(SCENARIO, 'reconciliation difference is 0', Number(reconRow.difference ?? 0), 0, 0.02);
  }

  const gstTcs = await runReport(ctx.adminToken, 'gst-tcs-summary', { ...win, vendorId: VENDORS.techworld.id });
  check(SCENARIO, 'gst-tcs-summary reachable', gstTcs.status === 200, `status=${gstTcs.status} rows=${gstTcs.rows?.length}`);
  const gstTcsTotalTaxable = (gstTcs.rows ?? []).reduce((s: number, r: any) => s + Number(r.taxableValue ?? 0), 0);
  assertTrue(SCENARIO, 'gst-tcs-summary includes this order taxable value', gstTcsTotalTaxable >= expected.taxableTotal - 0.02);

  const taxInvoiceReg = await runReport(ctx.adminToken, 'tax-invoice-register', win);
  check(SCENARIO, 'tax-invoice-register reachable', taxInvoiceReg.status === 200, `status=${taxInvoiceReg.status}`);
  const invoiceRow = findRowBy(taxInvoiceReg.rows ?? [], (r: any) => r.subOrderId === subOrder.id || r.orderId === orderId);
  assertTrue(SCENARIO, 'tax-invoice-register has a row for this order', Boolean(invoiceRow));
  if (invoiceRow) {
    assertClose(SCENARIO, 'tax-invoice-register taxable matches', Number(invoiceRow.taxable ?? 0), expected.taxableTotal);
    assertClose(SCENARIO, 'tax-invoice-register tax matches', Number(invoiceRow.tax ?? 0), expected.taxTotal);
  }

  const codRemit = await runReport(ctx.adminToken, 'cod-remittance', win);
  check(SCENARIO, 'cod-remittance reachable', codRemit.status === 200, `status=${codRemit.status} rows=${codRemit.rows?.length}`);

  // ---- Vendor report sweep ----
  const vendorToken = await loginAs(VENDORS.techworld.email, CUSTOMER_PASSWORD);
  const vendorSales = await runReport(vendorToken, 'vendor-sales', win);
  check(SCENARIO, 'vendor-sales reachable', vendorSales.status === 200, `status=${vendorSales.status} rows=${vendorSales.rows?.length}`);
  const vendorSalesRow = findRowBy(vendorSales.rows ?? [], (r: any) => r.subOrderId === subOrder.id);
  assertTrue(SCENARIO, 'vendor-sales has this sub-order', Boolean(vendorSalesRow));

  const vendorCommission = await runReport(vendorToken, 'vendor-commission-deducted', win);
  check(
    SCENARIO,
    'vendor-commission-deducted reachable',
    vendorCommission.status === 200,
    `status=${vendorCommission.status}`,
  );

  const { status: commissionsStatus, json: commissionsJson } = await get('/api/commissions', vendorToken);
  check(SCENARIO, 'GET /api/commissions reachable', commissionsStatus === 200, `status=${commissionsStatus}`);
  const commissionRow = (commissionsJson?.data?.rows ?? commissionsJson?.data ?? []).find(
    (r: any) => r.subOrderId === subOrder.id,
  );
  assertTrue(SCENARIO, 'commission ledger row exists for this sub-order', Boolean(commissionRow));
  if (commissionRow) {
    assertClose(SCENARIO, 'commission ledger saleAmount matches', Number(commissionRow.saleAmount ?? 0), expected.taxableTotal);
    assertClose(
      SCENARIO,
      'commission ledger commissionAmount matches',
      Number(commissionRow.commissionAmount ?? 0),
      expected.commissionTotal,
    );
  }

  // ---- Customer report sweep ----
  const orderHistory = await get(
    `/api/reports/customer/order-history?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}&format=json`,
    customerToken,
  );
  check(SCENARIO, 'customer order-history reachable', orderHistory.status === 200, `status=${orderHistory.status}`);

  // ---- Delivery agent flow: ship -> assign -> out-for-delivery -> OTP -> confirm ----
  const agent = CREDENTIALS.deliveryAgents[0]!;
  const agentLogin = await loginAs(agent.email, agent.password);

  const shipRes = await patch(
    `/api/suborders/${subOrder.id}/status`,
    { status: 'SHIPPED', trackingId: `E2E-${Date.now()}` },
    ctx.adminToken,
  );
  check(SCENARIO, 'suborder ship (SHIPPED)', shipRes.status === 200, `status=${shipRes.status} body=${JSON.stringify(shipRes.json).slice(0, 300)}`);
  const shipmentId: string | undefined = shipRes.json?.data?.shipment?.id;
  assertTrue(SCENARIO, 'shipment created on ship', Boolean(shipmentId));

  // Fetch the delivery agent's own id from the login response (already present in the JWT/user object).
  const loginRes = await post('/api/auth/login', { email: agent.email, password: agent.password });
  const deliveryAgentId: string = loginRes.json?.data?.user?.deliveryAgentId;
  assertTrue(SCENARIO, 'delivery agent id resolved', Boolean(deliveryAgentId));

  const assignRes = await post(
    `/api/delivery-agents/shipments/${shipmentId}/assign`,
    { deliveryAgentId },
    ctx.adminToken,
  );
  check(SCENARIO, 'assign shipment to agent', assignRes.status === 200, `status=${assignRes.status} body=${JSON.stringify(assignRes.json).slice(0, 300)}`);

  const outForDeliveryRes = await patch(
    `/api/delivery-agents/me/deliveries/${shipmentId}/status`,
    { status: 'OUT_FOR_DELIVERY' },
    agentLogin,
  );
  check(
    SCENARIO,
    'mark OUT_FOR_DELIVERY',
    outForDeliveryRes.status === 200,
    `status=${outForDeliveryRes.status} body=${JSON.stringify(outForDeliveryRes.json).slice(0, 300)}`,
  );

  const otpCode = await pollDeliveryOtp(order.userId);
  assertTrue(SCENARIO, 'delivery OTP retrieved from queue', Boolean(otpCode), 'no DELIVERY_OTP job found for customer');

  // Shift summary before confirmation
  const shiftBefore = await get('/api/delivery-agents/me/shift-summary', agentLogin);

  if (otpCode) {
    const confirmRes = await post(
      `/api/delivery-agents/me/deliveries/${shipmentId}/confirm`,
      { otpCode, codCollected: true },
      agentLogin,
    );
    check(
      SCENARIO,
      'confirm delivery with OTP + codCollected',
      confirmRes.status === 200,
      `status=${confirmRes.status} body=${JSON.stringify(confirmRes.json).slice(0, 300)}`,
    );

    const { data: orderAfterDelivery } = await getOrder(customerToken, orderId);
    assertEqual(
      SCENARIO,
      'order paymentStatus flips to PAID after COD delivery settlement',
      orderAfterDelivery?.paymentStatus,
      'PAID',
    );

    const shiftAfter = await get('/api/delivery-agents/me/shift-summary', agentLogin);
    const before = shiftBefore.json?.data ?? {};
    const after = shiftAfter.json?.data ?? {};
    assertClose(
      SCENARIO,
      'agent earningsToday increased by exactly perTaskEarning',
      Number(after.earningsToday ?? 0) - Number(before.earningsToday ?? 0),
      ctx.deliveryAgentPerTaskEarning,
    );
    assertEqual(
      SCENARIO,
      'agent deliveredToday incremented by 1',
      Number(after.deliveredToday ?? 0) - Number(before.deliveredToday ?? 0),
      1,
    );
  }

  return { orderId, subOrderId: subOrder.id, customerToken, customerUserId: order.userId };
}
