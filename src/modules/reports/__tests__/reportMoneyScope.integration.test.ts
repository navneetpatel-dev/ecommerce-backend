/**
 * Money on the customer-analytics report, coupon analytics and the settlement
 * reconciliation counts only what was actually charged and kept:
 * - unpaid and failed orders are not customer spend or coupon revenue;
 * - a cancelled sub-order leaves settlement tax and shipping, as it leaves GMV.
 *
 * Seeds one customer and vendor: a paid order with a live and a cancelled
 * sub-order (coupon applied), an unpaid order and a failed order (same coupon).
 * Skips when Postgres is unreachable.
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

type SubSpec = { status: string; subtotal: number; tax: number; shipping: number };

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
      shippingCost: spec.shipping,
      shippingCostPaise: toPaise(spec.shipping),
      shippingDiscountAmount: 0,
      taxAmount: spec.tax,
      taxAmountPaise: toPaise(spec.tax),
      taxableAmount: spec.subtotal,
      taxableAmountPaise: toPaise(spec.subtotal),
      discountAmount: 0,
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

    // Paid: ₹1,000 + ₹180 tax + ₹50 shipping live, ₹300 + ₹54 + ₹40 cancelled → charged ₹1,624.
    await seedOrder({
      ...base,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      paymentStatus: PAYMENT_STATUS.PAID,
      status: ORDER_STATUS.DELIVERED,
      couponDiscount: 50,
      subOrders: [
        { status: ORDER_STATUS.DELIVERED, subtotal: 1000, tax: 180, shipping: 50 },
        { status: ORDER_STATUS.CANCELLED, subtotal: 300, tax: 54, shipping: 40 },
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

  it('customer analytics counts only charged orders', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const report = await getReportDefinition('customer-analytics')!.query({
      ...range,
      page: 1,
      limit: 100_000,
    });
    const row = report.rows.find((r) => r.userId === customerId);
    assert.equal(row?.orderCount, 1);
    assert.equal(row?.totalSpent, 1624);
  });

  it('coupon analytics counts only charged orders', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const analytics = await couponsService.analytics(couponId);
    assert.equal(analytics.revenueImpact, 1624);
    assert.equal(analytics.totalDiscount, 50);
  });

  it('settlement tax and shipping drop a cancelled sub-order', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const recon = await computeReconciliationSummary({ ...range, vendorId });
    assert.equal(fromPaise(recon.gmvPaise), 1000);
    assert.equal(fromPaise(recon.taxCollectedPaise), 180);
    assert.equal(fromPaise(recon.shippingCollectedPaise), 50);
  });
});
