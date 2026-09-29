/**
 * The settlement reconciliation balances to the paisa on a real priced order: a
 * platform-funded coupon, GST, TCS, commission, shipping, gift wrap, and a partial
 * seller-fault return (goods, tax and shipping refunded). Before, GST was counted
 * twice (it is inside the vendor's net) and the platform's coupon share and gift wrap
 * were not accounted, so the report could never balance.
 *
 * The order is dated in a far-off month so the platform-wide totals hold only it.
 * Skips when Postgres is unreachable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { Address } from '@database/models/address.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { Role } from '@database/models/role.model';
import { SubOrder } from '@database/models/subOrder.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import {
  COMMISSION_STATUS,
  DISCOUNT_BEARER,
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  RETURN_REASON,
  RETURN_STATUS,
  ROLES,
} from '@core/constants/statuses';
import { computeSubOrderBreakdown, reverseFrozenLine } from '@modules/pricing/pricing.engine';
import { fromPaise } from '@modules/pricing/money';
import { computeReconciliationSummary } from '@modules/reports/engine/queryHelpers';
import { getReportDefinition } from '@modules/reports/engine/reportRegistry';
import { ensureTestRoles } from '../../../testHelpers/ensureTestRoles';

const range = {
  from: new Date('2001-05-01T00:00:00+05:30'),
  to: new Date('2001-05-31T23:59:59.999+05:30'),
};
let dbReady = false;
const ids = { user: '', vendor: '', address: '', order: '', sub: '', item: '', ledger: '', ret: '' };

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

describe('reconciliation identity', () => {
  before(async () => {
    dbReady = await dbAvailable();
    if (!dbReady) return;
    await ensureTestRoles();
    const [variant] = await sequelize.query<{ id: string }>('SELECT id FROM product_variants LIMIT 1', {
      type: QueryTypes.SELECT,
    });
    if (!variant) {
      dbReady = false;
      return;
    }
    const role = await Role.findOne({ where: { name: ROLES.CUSTOMER } });
    const user = await User.create({
      name: 'Recon Customer',
      email: `recon-${randomUUID()}@example.com`,
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
    ids.user = user.id;
    const vendor = await Vendor.create({
      businessName: `Recon Vendor ${randomUUID().slice(0, 8)}`,
      slug: `recon-vendor-${randomUUID().slice(0, 8)}`,
      gstNumber: null,
      state: 'KA',
      bankDetails: {},
      status: 'APPROVED',
      commissionRate: 10,
      performanceScore: 0,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    } as never);
    ids.vendor = vendor.id;
    const address = await Address.create({
      userId: user.id,
      line1: 'Recon',
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
    ids.address = address.id;

    // 2 × ₹1,000 at 18%, a ₹200 platform coupon, 10% commission, 1% TCS, ₹50 shipping.
    const priced = computeSubOrderBreakdown({
      lines: [{ key: 'line', unitPricePaise: 100000, quantity: 2 }],
      merchandiseDiscountPaise: 20000,
      shippingDiscountPaise: 0,
      shippingCostPaise: 5000,
      gstPercentage: 18,
      intraState: true,
      commissionRatePercent: 10,
      discountBearer: DISCOUNT_BEARER.PLATFORM,
      tcsRatePercent: 1,
    });
    const line = priced.lines[0]!;
    const giftWrap = 49;
    const total = fromPaise(priced.customerTotalPaise) + giftWrap;
    const order = await Order.create({
      userId: user.id,
      couponId: null,
      appliedCouponIds: [],
      totalAmount: total,
      originalTotalAmount: total,
      discountTotal: fromPaise(priced.merchandiseDiscountPaise),
      status: ORDER_STATUS.DELIVERED,
      paymentStatus: PAYMENT_STATUS.PAID,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      walletAmountUsed: 0,
      razorpayAmountPaid: total,
      giftWrap: true,
      giftWrapFeeAmount: giftWrap,
      shippingAddressId: address.id,
      createdBy: user.id,
      updatedBy: user.id,
      deletedBy: null,
    } as never);
    ids.order = order.id;
    await sequelize.query(`UPDATE orders SET "createdAt" = '2001-05-10T10:00:00+05:30' WHERE id = :id`, {
      replacements: { id: order.id },
    });

    // The return: one unit, damaged — goods, tax and the part's shipping refunded.
    const reversal = reverseFrozenLine({
      line,
      returnQuantity: 1,
      reasonCode: RETURN_REASON.DAMAGED,
      shippingChargedPaise: priced.shippingChargedPaise,
      returnShippingFeePaise: 0,
    });
    const sub = await SubOrder.create({
      orderId: order.id,
      vendorId: vendor.id,
      status: ORDER_STATUS.DELIVERED,
      subtotalPaise: priced.subtotalPaise - reversal.refundSubtotalPaise,
      discountAmountPaise: priced.merchandiseDiscountPaise - reversal.refundDiscountPaise,
      taxableAmountPaise: priced.taxablePaise - reversal.refundMerchandisePaise,
      taxAmountPaise: priced.tax.total - reversal.refundTaxPaise,
      commissionAmountPaise: priced.commissionPaise - reversal.refundCommissionPaise,
      tcsAmountPaise: priced.tcsPaise - reversal.refundTcsPaise,
      netPayoutAmountPaise: priced.netPayoutPaise - reversal.refundNetClawbackPaise,
      shippingCostPaise: priced.shippingCostPaise,
      shippingDiscountAmountPaise: 0,
      createdBy: user.id,
      updatedBy: user.id,
      deletedBy: null,
    } as never);
    ids.sub = sub.id;
    const item = await OrderItem.create({
      subOrderId: sub.id,
      variantId: variant.id,
      productName: 'Recon item',
      quantity: 1,
      unitPrice: 1000,
      unitPricePaise: 100000,
      lineSubtotal: 1000,
      discountAmountPaise: line.discountPaise - reversal.refundDiscountPaise,
      taxableAmountPaise: line.taxablePaise - reversal.refundMerchandisePaise,
      taxAmountPaise: line.tax.total - reversal.refundTaxPaise,
      createdBy: user.id,
      updatedBy: user.id,
      deletedBy: null,
    } as never);
    ids.item = item.id;
    // Not yet paid out: the pending ledger was reduced in place by the return.
    const ledger = await CommissionLedger.create({
      vendorId: vendor.id,
      subOrderId: sub.id,
      commissionRate: 10,
      discountBearer: DISCOUNT_BEARER.PLATFORM,
      saleAmountPaise: priced.commissionBasePaise - reversal.refundMerchandisePaise,
      commissionAmountPaise: priced.commissionPaise - reversal.refundCommissionPaise,
      taxableAmountPaise: priced.taxablePaise - reversal.refundMerchandisePaise,
      discountAmountPaise: priced.merchandiseDiscountPaise - reversal.refundDiscountPaise,
      taxAmountPaise: priced.tax.total - reversal.refundTaxPaise,
      tcsAmountPaise: priced.tcsPaise - reversal.refundTcsPaise,
      netPayoutAmountPaise: priced.netPayoutPaise - reversal.refundNetClawbackPaise,
      shippingCollectedPaise: priced.shippingChargedPaise,
      status: COMMISSION_STATUS.PENDING,
    } as never);
    ids.ledger = ledger.id;
    const ret = await ReturnRequest.create({
      subOrderId: sub.id,
      orderItemId: item.id,
      userId: user.id,
      reason: 'Damaged',
      reasonCode: RETURN_REASON.DAMAGED,
      type: 'REFUND',
      returnQuantity: 1,
      photoUrls: [],
      status: RETURN_STATUS.APPROVED,
      refundStatus: 'PENDING',
      refundAmount: fromPaise(reversal.customerRefundPaise),
      refundTaxAmount: fromPaise(reversal.refundTaxPaise),
      refundMerchandiseAmountPaise: reversal.refundMerchandisePaise,
      shippingRefundAmount: fromPaise(reversal.shippingRefundPaise),
      returnShippingFeeAmount: 0,
      resolvedById: null,
      resolvedAt: null,
      createdBy: user.id,
      updatedBy: null,
      deletedBy: null,
    } as never);
    ids.ret = ret.id;
  });

  after(async () => {
    if (!dbReady) return;
    await ReturnRequest.destroy({ where: { id: ids.ret }, force: true });
    await CommissionLedger.destroy({ where: { id: ids.ledger }, force: true });
    await OrderItem.destroy({ where: { id: ids.item }, force: true });
    await SubOrder.destroy({ where: { id: ids.sub }, force: true });
    await Order.destroy({ where: { id: ids.order }, force: true });
    await Address.destroy({ where: { id: ids.address }, force: true });
    await User.destroy({ where: { id: ids.user }, force: true });
    await Vendor.destroy({ where: { id: ids.vendor }, force: true });
  });

  it('balances platform-wide: every rupee the customer paid is accounted once', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const summary = await computeReconciliationSummary(range);
    assert.ok(summary.customerPaymentsPaise > 0);
    assert.ok(summary.platformFundedDiscountPaise > 0, 'the platform coupon share is accounted');
    assert.equal(summary.giftWrapPaise, 4900);
    assert.ok(summary.shippingRefundedPaise > 0);
    assert.equal(summary.accountedPaise, summary.customerPaymentsPaise);

    const report = await getReportDefinition('reconciliation')!.query({ ...range, page: 1, limit: 1 });
    assert.equal(report.rows[0]?.status, 'BALANCED');
    assert.equal(report.rows[0]?.difference, 0);
  });

  it("balances for one vendor's parts", async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const summary = await computeReconciliationSummary({ ...range, vendorId: ids.vendor });
    assert.equal(summary.giftWrapPaise, 0);
    assert.equal(summary.accountedPaise, summary.customerPaymentsPaise);
  });
});
