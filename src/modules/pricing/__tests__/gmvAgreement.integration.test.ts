/**
 * Every GMV surface must publish the same number (GMV_SUB_ORDER_SQL): the
 * settlement reconciliation, the gmv-sales report (by vendor and by category),
 * the platform-analytics report, the admin dashboard, and the vendor dashboard.
 *
 * Seeds one vendor with a paid order that has a cancelled sub-order, a placed
 * COD order, an unpaid Razorpay order and a failed one, then checks each
 * surface counts exactly the paid live sub-order and the COD order.
 * Skips when Postgres is unreachable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { Address } from '@database/models/address.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Role } from '@database/models/role.model';
import { SubOrder } from '@database/models/subOrder.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS, ROLES } from '@core/constants/statuses';
import { adminService } from '@modules/admin/admin.service';
import { vendorsService } from '@modules/vendors/vendors.service';
import { computeReconciliationSummary } from '@modules/reports/engine/queryHelpers';
import { getReportDefinition } from '@modules/reports/engine/reportRegistry';
import { fromPaise, toPaise } from '../money';
import { ensureTestRoles } from '../../../testHelpers/ensureTestRoles';

const DAY_MS = 24 * 60 * 60 * 1000;

let dbReady = false;
let vendorId = '';
let categoryId = '';
const created = { users: [] as string[], vendors: [] as string[], orders: [] as string[] };

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
  userId: string;
  addressId: string;
  variantId: string;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  subOrders: Array<{ status: string; unitPrice: number; quantity: number }>;
}) {
  const subtotal = params.subOrders.reduce((sum, s) => sum + s.unitPrice * s.quantity, 0);
  const order = await Order.create({
    userId: params.userId,
    couponId: null,
    appliedCouponIds: [],
    totalAmount: subtotal,
    originalTotalAmount: subtotal,
    discountTotal: 0,
    status: params.status,
    paymentStatus: params.paymentStatus,
    paymentMethod: params.paymentMethod,
    walletAmountUsed: 0,
    razorpayAmountPaid: params.paymentMethod === PAYMENT_METHOD.COD ? 0 : subtotal,
    shippingAddressId: params.addressId,
    createdBy: params.userId,
    updatedBy: params.userId,
    deletedBy: null,
  } as never);
  created.orders.push(order.id);

  for (const line of params.subOrders) {
    const amount = line.unitPrice * line.quantity;
    const sub = await SubOrder.create({
      orderId: order.id,
      vendorId,
      status: line.status,
      subtotal: amount,
      subtotalPaise: toPaise(amount),
      shippingCost: 0,
      shippingDiscountAmount: 0,
      taxAmount: 0,
      taxableAmount: amount,
      taxableAmountPaise: toPaise(amount),
      discountAmount: 0,
      createdBy: params.userId,
      updatedBy: params.userId,
      deletedBy: null,
    } as never);
    await OrderItem.create({
      subOrderId: sub.id,
      variantId: params.variantId,
      productName: 'GMV agreement item',
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      unitPricePaise: toPaise(line.unitPrice),
      lineSubtotal: amount,
      discountAmount: 0,
      taxableAmount: amount,
      taxableAmountPaise: toPaise(amount),
      taxAmount: 0,
      createdBy: params.userId,
      updatedBy: params.userId,
      deletedBy: null,
    } as never);
  }
}

describe('GMV agreement across surfaces', () => {
  const now = new Date();
  const range = { from: new Date(now.getTime() - DAY_MS), to: new Date(now.getTime() + DAY_MS) };

  before(async () => {
    dbReady = await dbAvailable();
    if (!dbReady) return;
    await ensureTestRoles();

    const [variant] = await sequelize.query<{ id: string; categoryId: string }>(
      `SELECT pv.id, p."categoryId" AS "categoryId"
       FROM product_variants pv
       INNER JOIN products p ON p.id = pv."productId"
       WHERE p."categoryId" IS NOT NULL
       LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    if (!variant) {
      dbReady = false;
      return;
    }
    categoryId = variant.categoryId;

    const role = await Role.findOne({ where: { name: ROLES.CUSTOMER } });
    const user = await User.create({
      name: 'GMV Agreement Customer',
      email: `gmv-agreement-${randomUUID()}@example.com`,
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
    created.users.push(user.id);

    const vendor = await Vendor.create({
      businessName: `GMV Vendor ${randomUUID().slice(0, 8)}`,
      slug: `gmv-vendor-${randomUUID().slice(0, 8)}`,
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
    created.vendors.push(vendor.id);

    const address = await Address.create({
      userId: user.id,
      line1: 'Line 1',
      line2: null,
      city: 'Bengaluru',
      state: 'KA',
      country: 'IN',
      pincode: '560001',
      isDefault: true,
      createdBy: user.id,
      updatedBy: user.id,
      deletedBy: null,
    });
    const base = { userId: user.id, addressId: address.id, variantId: variant.id };

    // Counts: the delivered sub-order (₹1,000). Not: its cancelled sibling (₹300).
    await seedOrder({
      ...base,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      paymentStatus: PAYMENT_STATUS.PAID,
      status: ORDER_STATUS.DELIVERED,
      subOrders: [
        { status: ORDER_STATUS.DELIVERED, unitPrice: 250, quantity: 4 },
        { status: ORDER_STATUS.CANCELLED, unitPrice: 300, quantity: 1 },
      ],
    });
    // Counts: placed COD, not yet collected (₹200).
    await seedOrder({
      ...base,
      paymentMethod: PAYMENT_METHOD.COD,
      paymentStatus: PAYMENT_STATUS.PENDING,
      status: ORDER_STATUS.CONFIRMED,
      subOrders: [{ status: ORDER_STATUS.CONFIRMED, unitPrice: 100, quantity: 2 }],
    });
    // Not counted: unpaid and failed online payments.
    await seedOrder({
      ...base,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      paymentStatus: PAYMENT_STATUS.PENDING,
      status: ORDER_STATUS.PENDING,
      subOrders: [{ status: ORDER_STATUS.PENDING, unitPrice: 700, quantity: 1 }],
    });
    await seedOrder({
      ...base,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      paymentStatus: PAYMENT_STATUS.FAILED,
      status: ORDER_STATUS.PENDING,
      subOrders: [{ status: ORDER_STATUS.PENDING, unitPrice: 900, quantity: 1 }],
    });
  });

  after(async () => {
    if (!dbReady) return;
    for (const orderId of created.orders) {
      const subs = await SubOrder.findAll({ where: { orderId } });
      for (const sub of subs) {
        await OrderItem.destroy({ where: { subOrderId: sub.id }, force: true });
        await sub.destroy({ force: true });
      }
      await Order.destroy({ where: { id: orderId }, force: true });
    }
    for (const userId of created.users) {
      await Address.destroy({ where: { userId }, force: true });
      await User.destroy({ where: { id: userId }, force: true });
    }
    await Vendor.destroy({ where: { id: created.vendors }, force: true });
  });

  it('vendor-scoped surfaces all report ₹1,200', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const expected = 1200;

    const recon = await computeReconciliationSummary({ ...range, vendorId });
    assert.equal(fromPaise(recon.gmvPaise), expected, 'settlement reconciliation');

    const gmvSales = getReportDefinition('gmv-sales')!;
    const byVendor = await gmvSales.query({ ...range, vendorId, page: 1, limit: 10 });
    assert.equal(byVendor.rows[0]?.gmv, expected, 'gmv-sales by vendor');
    const byCategory = await gmvSales.query({ ...range, vendorId, categoryId, page: 1, limit: 10 });
    assert.equal(byCategory.rows[0]?.gmv, expected, 'gmv-sales by category');

    const analytics = await vendorsService.getDashboardAnalytics(vendorId, 2);
    const chartTotal = fromPaise(
      analytics.revenue.reduce((sum, day) => sum + toPaise(day.amount), 0),
    );
    assert.equal(chartTotal, expected, 'vendor revenue chart');
    assert.equal(analytics.topProducts[0]?.revenue, expected, 'vendor top products');

    const summary = await vendorsService.getDashboardSummary(vendorId);
    assert.equal(summary.monthRevenue, expected, 'vendor month revenue');
  });

  it('platform surfaces agree with the settlement reconciliation', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const allTime = { from: new Date(0), to: new Date(now.getTime() + DAY_MS) };
    const recon = await computeReconciliationSummary(allTime);
    const analytics = await adminService.getPlatformAnalytics();
    assert.equal(analytics.gmv, fromPaise(recon.gmvPaise), 'admin dashboard GMV');

    const metrics = await adminService.getDashboardMetrics();
    assert.equal(metrics.totalRevenue, analytics.gmv, 'admin dashboard metrics revenue');

    const window = { from: new Date(now.getTime() - 365 * DAY_MS), to: allTime.to };
    const windowRecon = await computeReconciliationSummary(window);
    const report = await getReportDefinition('platform-analytics')!.query({
      ...window,
      page: 1,
      limit: 1000,
    });
    const gmvRow = report.rows.find((row) => row.metric === 'GMV (in range)');
    assert.equal(gmvRow?.value, fromPaise(windowRecon.gmvPaise), 'platform-analytics report');
  });
});
