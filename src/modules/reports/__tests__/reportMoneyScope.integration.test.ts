/**
 * Money on the customer-analytics report, coupon analytics and the settlement
 * reconciliation counts only what was actually charged and kept:
 * - unpaid and failed orders are not customer spend or coupon revenue;
 * - a cancelled sub-order leaves settlement tax and shipping, as it leaves GMV,
 *   and its refunded customer total leaves the order's payment;
 * - a fully cancelled order still PAID while its Razorpay refund is pending
 *   counts nowhere.
 *
 * Seeds one customer and vendor: a paid order with a live and a cancelled
 * sub-order (coupon applied), an unpaid order, a failed order, and a cancelled
 * order awaiting its refund (same coupon). Skips when Postgres is unreachable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { Address } from '@database/models/address.model';
import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Role } from '@database/models/role.model';
import { SubOrder } from '@database/models/subOrder.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, ROLES } from '@core/constants/statuses';
import { couponsService } from '@modules/coupons/coupons.service';
import { computeReconciliationSummary } from '@modules/reports/engine/queryHelpers';
import { getReportDefinition } from '@modules/reports/engine/reportRegistry';
import { fromPaise, toPaise } from '@modules/pricing/money';
import { ensureTestRoles } from '../../../testHelpers/ensureTestRoles';

const DAY_MS = 24 * 60 * 60 * 1000;

let dbReady = false;
let customerId = '';
let vendorId = '';
let couponId = '';
const created = { orders: [] as string[] };

type SubSpec = {
  status: string;
  subtotal: number;
  tax: number;
  shipping: number;
  /** The coupon discount on this part (checkout splits the order's across its parts). */
  discount?: number;
};

async function dbAvailable(): Promise<boolean> {
  try {
    await Promise.race([
      sequelize.authenticate(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function seedOrder(params: {
  addressId: string;
  variantId: string;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  couponDiscount: number;
  subOrders: SubSpec[];
}) {
  const total = params.subOrders.reduce((sum, s) => sum + s.subtotal + s.tax + s.shipping, 0);
  const order = await Order.create({
    userId: customerId,
    couponId: null,
    appliedCouponIds: [],
    totalAmount: total,
    originalTotalAmount: total,
    discountTotal: params.couponDiscount,
    status: params.status,
    paymentStatus: params.paymentStatus,
    paymentMethod: params.paymentMethod,
    walletAmountUsed: 0,
    razorpayAmountPaid: params.paymentMethod === PAYMENT_METHOD.COD ? 0 : total,
    shippingAddressId: params.addressId,
    createdBy: customerId,
    updatedBy: customerId,
    deletedBy: null,
  } as never);
  created.orders.push(order.id);

  for (const spec of params.subOrders) {
    const sub = await SubOrder.create({
      orderId: order.id,
      vendorId,
      status: spec.status,
      subtotal: spec.subtotal,
      subtotalPaise: toPaise(spec.subtotal),
      customerTotal: spec.subtotal + spec.tax + spec.shipping,
      shippingCost: spec.shipping,
      shippingCostPaise: toPaise(spec.shipping),
      shippingDiscountAmount: 0,
      taxAmount: spec.tax,
      taxAmountPaise: toPaise(spec.tax),
      taxableAmount: spec.subtotal,
      taxableAmountPaise: toPaise(spec.subtotal),
      discountAmount: spec.discount ?? 0,
      discountAmountPaise: toPaise(spec.discount ?? 0),
      createdBy: customerId,
      updatedBy: customerId,
      deletedBy: null,
    } as never);
    await OrderItem.create({
      subOrderId: sub.id,
      variantId: params.variantId,
      productName: 'Report scope item',
      quantity: 1,
      unitPrice: spec.subtotal,
      unitPricePaise: toPaise(spec.subtotal),
      lineSubtotal: spec.subtotal,
      discountAmount: 0,
      taxableAmount: spec.subtotal,
      taxAmount: spec.tax,
      createdBy: customerId,
      updatedBy: customerId,
      deletedBy: null,
    } as never);
  }

  await CouponUsage.create({
    couponId,
    userId: customerId,
    orderId: order.id,
    discountApplied: params.couponDiscount,
    createdBy: customerId,
    updatedBy: customerId,
    deletedBy: null,
  } as never);
}

describe('report money scope', () => {
  const now = new Date();
  const range = { from: new Date(now.getTime() - DAY_MS), to: new Date(now.getTime() + DAY_MS) };

  before(async () => {
    dbReady = await dbAvailable();
    if (!dbReady) return;
    await ensureTestRoles();

    const [variant] = await sequelize.query<{ id: string }>(
      'SELECT id FROM product_variants LIMIT 1',
      { type: QueryTypes.SELECT },
    );
    if (!variant) {
      dbReady = false;
      return;
    }

    const role = await Role.findOne({ where: { name: ROLES.CUSTOMER } });
    const customer = await User.create({
      name: 'Report Scope Customer',
      email: `report-scope-${randomUUID()}@example.com`,
      passwordHash: 'x',
      roleId: role!.id,
      status: 'ACTIVE',
      phone: null,
      vendorId: null,
      avatarUrl: null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    });
    customerId = customer.id;

    const vendor = await Vendor.create({
      businessName: `Scope Vendor ${randomUUID().slice(0, 8)}`,
      slug: `scope-vendor-${randomUUID().slice(0, 8)}`,
      gstNumber: null,
      state: 'KA',
      bankDetails: {},
      logoUrl: null,
      bannerUrl: null,
      description: null,
      status: 'APPROVED',
      rejectionReason: null,
      suspensionReason: null,
      commissionRate: 10,
      performanceScore: 0,
      returnShippingFee: null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    } as never);
    vendorId = vendor.id;

    const coupon = await Coupon.create({
      code: `SCOPE${randomUUID().slice(0, 8).toUpperCase()}`,
      type: 'FLAT',
      value: 50,
      config: {},
      startDate: new Date(now.getTime() - DAY_MS),
      endDate: new Date(now.getTime() + DAY_MS),
      status: 'ACTIVE',
      createdById: customerId,
    } as never);
    couponId = coupon.id;

    const address = await Address.create({
      userId: customerId,
      line1: 'Line 1',
      line2: null,
      city: 'Bengaluru',
      state: 'KA',
      country: 'IN',
      pincode: '560001',
      isDefault: true,
      createdBy: customerId,
      updatedBy: customerId,
      deletedBy: null,
    });
    const base = { addressId: address.id, variantId: variant.id };

    // Paid: ₹1,000 + ₹180 tax + ₹50 shipping live, ₹300 + ₹54 + ₹40 cancelled and
    // ₹200 + ₹36 + ₹20 RTO'd → charged ₹1,880, of which ₹394 + ₹256 was refunded →
    // kept ₹1,230.
    await seedOrder({
      ...base,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      paymentStatus: PAYMENT_STATUS.PAID,
      status: ORDER_STATUS.DELIVERED,
      couponDiscount: 50,
      subOrders: [
        // The ₹50 coupon discount split ₹30 / ₹12 / ₹8 across the three parts.
        { status: ORDER_STATUS.DELIVERED, subtotal: 1000, tax: 180, shipping: 50, discount: 30 },
        { status: ORDER_STATUS.CANCELLED, subtotal: 300, tax: 54, shipping: 40, discount: 12 },
        // Came back undelivered (RTO) and refunded: out of every total like the cancelled one.
        { status: ORDER_STATUS.RETURNED, subtotal: 200, tax: 36, shipping: 20, discount: 8 },
      ],
    });
    // Never charged: an unpaid and a failed online payment, same coupon.
    await seedOrder({
      ...base,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      paymentStatus: PAYMENT_STATUS.PENDING,
      status: ORDER_STATUS.PENDING,
      couponDiscount: 50,
      subOrders: [{ status: ORDER_STATUS.PENDING, subtotal: 700, tax: 126, shipping: 50 }],
    });
    await seedOrder({
      ...base,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      paymentStatus: PAYMENT_STATUS.FAILED,
      status: ORDER_STATUS.PENDING,
      couponDiscount: 50,
      subOrders: [{ status: ORDER_STATUS.PENDING, subtotal: 900, tax: 162, shipping: 50 }],
    });
    // Cancelled after payment: stays PAID until Razorpay reports the refund processed.
    await seedOrder({
      ...base,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      paymentStatus: PAYMENT_STATUS.PAID,
      status: ORDER_STATUS.CANCELLED,
      couponDiscount: 50,
      subOrders: [{ status: ORDER_STATUS.CANCELLED, subtotal: 800, tax: 144, shipping: 50 }],
    });
  });

  after(async () => {
    if (!dbReady) return;
    await CouponUsage.destroy({ where: { couponId }, force: true });
    await Coupon.destroy({ where: { id: couponId }, force: true });
    for (const orderId of created.orders) {
      const subs = await SubOrder.findAll({ where: { orderId } });
      for (const sub of subs) {
        await OrderItem.destroy({ where: { subOrderId: sub.id }, force: true });
        await sub.destroy({ force: true });
      }
      await Order.destroy({ where: { id: orderId }, force: true });
    }
    await Address.destroy({ where: { userId: customerId }, force: true });
    await User.destroy({ where: { id: customerId }, force: true });
    await Vendor.destroy({ where: { id: vendorId }, force: true });
  });

  it('customer analytics counts only charged and kept orders', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const report = await getReportDefinition('customer-analytics')!.query({
      ...range,
      page: 1,
      limit: 100_000,
    });
    const row = report.rows.find((r) => r.userId === customerId);
    assert.equal(row?.orderCount, 1);
    assert.equal(row?.totalSpent, 1230);
  });

  it('coupon analytics counts only charged and kept orders', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const analytics = await couponsService.analytics(couponId);
    assert.equal(analytics.revenueImpact, 1230);
    // The discount on the cancelled and RTO'd parts was refunded with them: ₹30, not ₹50.
    assert.equal(analytics.totalDiscount, 30);
  });

  it("a vendor's absorbed discount counts only charged orders and parts still standing", async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const vendorCoupon = await Coupon.create({
      code: `VSCOPE${randomUUID().slice(0, 8).toUpperCase()}`,
      type: 'FLAT',
      value: 50,
      config: {},
      vendorId,
      discountBearer: 'VENDOR',
      startDate: new Date(now.getTime() - DAY_MS),
      endDate: new Date(now.getTime() + DAY_MS),
      status: 'ACTIVE',
      createdById: customerId,
    } as never);
    try {
      // Redeemed on the paid order (₹30 of its ₹50 still stands) and on the unpaid one.
      for (const orderId of created.orders.slice(0, 2)) {
        await CouponUsage.create({
          couponId: vendorCoupon.id,
          userId: customerId,
          orderId,
          discountApplied: 50,
          createdBy: customerId,
          updatedBy: customerId,
          deletedBy: null,
        } as never);
      }
      const summary = await couponsService.vendorAbsorbedDiscountSummary(vendorId);
      assert.equal(summary.absorbedDiscountTotal, 30);
    } finally {
      await CouponUsage.destroy({ where: { couponId: vendorCoupon.id }, force: true });
      await vendorCoupon.destroy({ force: true });
    }
  });

  it('settlement tax and shipping drop a cancelled sub-order', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const recon = await computeReconciliationSummary({ ...range, vendorId });
    assert.equal(fromPaise(recon.gmvPaise), 1000);
    assert.equal(fromPaise(recon.taxCollectedPaise), 180);
    assert.equal(fromPaise(recon.shippingCollectedPaise), 50);
  });

  it('settlement customer payments drop cancelled sub-orders and cancelled orders', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const recon = await computeReconciliationSummary({ ...range, vendorId });
    // Live sub-order only: ₹1,000 + ₹180 + ₹50. The cancelled ₹394 part and the
    // ₹994 order awaiting its refund have nothing accounted against them.
    assert.equal(fromPaise(recon.customerPaymentsPaise), 1230);
  });

  it('GST reports leave out a cancelled sub-order and their CGST + SGST add up to the tax', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const scoped = { ...range, vendorId, page: 1, limit: 100 };

    const state = await getReportDefinition('state-tax-collection')!.query(scoped);
    const ka = state.rows.find((row) => row.state === 'KA');
    // Live sub-order only (₹180), not the cancelled one's ₹54. No stored breakdown on
    // these rows, so the paise tax is split: ₹90 + ₹90.
    assert.equal(ka?.taxTotal, 180);
    assert.equal(ka?.cgst, 90);
    assert.equal(ka?.sgst, 90);
    assert.equal(ka?.igst, 0);

    const hsn = await getReportDefinition('hsn-sales-summary')!.query(scoped);
    const totalTax = hsn.rows.reduce((sum, row) => sum + toPaise(Number(row.tax)), 0);
    const totalTaxable = hsn.rows.reduce((sum, row) => sum + toPaise(Number(row.taxable)), 0);
    assert.equal(fromPaise(totalTax), 180);
    assert.equal(fromPaise(totalTaxable), 1000);
  });

  it('GST reports include gift-wrap GST, not for a vendor or a cancelled order', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const giftState = `GW-${randomUUID().slice(0, 6)}`;
    const address = await Address.create({
      userId: customerId,
      line1: 'Gift wrap',
      line2: null,
      city: 'Chennai',
      state: giftState,
      country: 'IN',
      pincode: '600001',
      isDefault: false,
      createdBy: customerId,
      updatedBy: customerId,
      deletedBy: null,
    });
    const snapshot = {
      invoiceNumber: `PLAT/TEST/${randomUUID().slice(0, 6)}`,
      issuedAt: now.toISOString(),
      intraState: false,
      totalPaise: 4900,
      lines: [
        {
          description: 'Gift wrapping',
          sac: '9985',
          quantity: 1,
          gstRatePercent: 18,
          taxablePaise: 4153,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 747,
        },
      ],
    };
    for (const status of [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED]) {
      const order = await Order.create({
        userId: customerId,
        couponId: null,
        appliedCouponIds: [],
        totalAmount: 49,
        originalTotalAmount: 49,
        discountTotal: 0,
        status,
        paymentStatus: PAYMENT_STATUS.PAID,
        paymentMethod: PAYMENT_METHOD.RAZORPAY,
        walletAmountUsed: 0,
        razorpayAmountPaid: 49,
        shippingAddressId: address.id,
        giftWrap: true,
        giftWrapFeeAmount: 49,
        platformInvoiceSnapshot: snapshot,
        createdBy: customerId,
        updatedBy: customerId,
        deletedBy: null,
      } as never);
      created.orders.push(order.id);
    }

    const all = { ...range, page: 1, limit: 100_000 };
    const state = await getReportDefinition('state-tax-collection')!.query(all);
    const gift = state.rows.find((row) => row.state === giftState);
    // The delivered order's ₹7.47 IGST only; the cancelled order's fee was refunded.
    assert.equal(gift?.taxTotal, 7.47);
    assert.equal(gift?.igst, 7.47);
    assert.equal(gift?.cgst, 0);

    const hsn = await getReportDefinition('hsn-sales-summary')!.query(all);
    const sac = hsn.rows.find((row) => row.hsnCode === '9985');
    assert.ok(sac && Number(sac.tax) >= 7.47);

    // A vendor's reports hold only that vendor's sales.
    const vendorState = await getReportDefinition('state-tax-collection')!.query({ ...all, vendorId });
    assert.equal(vendorState.rows.find((row) => row.state === giftState), undefined);
  });
});
