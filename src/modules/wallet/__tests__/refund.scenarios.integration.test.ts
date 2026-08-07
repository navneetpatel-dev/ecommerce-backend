/**
 * Seeded verification of consolidated_refund_prompt scenarios against real DB + services.
 * Skips the whole suite if Postgres is unreachable within 2s.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sequelize } from '@database/models';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { WalletLedger } from '@database/models/walletLedger.model';
import { WalletWriteOff } from '@database/models/walletWriteOff.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { CreditNote } from '@database/models/creditNote.model';
import { DebitNote } from '@database/models/debitNote.model';
import { Address } from '@database/models/address.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { PlatformSetting } from '@database/models/platformSetting.model';
import { walletService } from '@modules/wallet/wallet.service';
import { returnsService } from '@modules/returns/returns.service';
import { paymentsService } from '@modules/payments/payments.service';
import {
  creditPendingCashbackForOrder,
  clawbackCashbackForReturn,
} from '@modules/wallet/cashback.service';
import {
  COMMISSION_REFERENCE_TYPE,
  COMMISSION_STATUS,
  DISCOUNT_BEARER,
  ORDER_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  REFUND_STATUS,
  RETURN_REASON,
  RETURN_STATUS,
  ROLES,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { toPaise } from '@modules/pricing/money';

let dbReady = false;
let sharedVariantId: string | null = null;
const cleanupIds = {
  users: [] as string[],
  vendors: [] as string[],
  orders: [] as string[],
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function roleId(name: string): Promise<string> {
  const role = await Role.findOne({ where: { name } });
  if (!role) throw new Error(`Missing role ${name}`);
  return role.id;
}

async function createCustomer(): Promise<User> {
  const user = await User.create({
    name: 'Refund Scenario Customer',
    email: `refund-scen-${randomUUID()}@example.com`,
    passwordHash: 'x',
    roleId: await roleId(ROLES.CUSTOMER),
    status: 'ACTIVE',
    phone: null,
    vendorId: null,
    avatarUrl: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
  });
  cleanupIds.users.push(user.id);
  return user;
}

async function createVendor(returnShippingFee: number | null = null): Promise<Vendor> {
  const vendor = await Vendor.create({
    businessName: `Refund Vendor ${randomUUID().slice(0, 8)}`,
    slug: `refund-vendor-${randomUUID().slice(0, 8)}`,
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
    returnShippingFee,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
  });
  cleanupIds.vendors.push(vendor.id);
  return vendor;
}

type SeedOrderOpts = {
  userId: string;
  vendorId: string;
  paymentMethod: 'COD' | 'RAZORPAY';
  totalAmount: number;
  walletAmountUsed?: number;
  razorpayAmountPaid?: number;
  razorpayPaymentId?: string | null;
  pendingCashbackAmount?: number;
  cashbackDiscountBearer?: 'PLATFORM' | 'VENDOR' | null;
  cashbackVendorId?: string | null;
  cashbackCreditedAt?: Date | null;
  shippingCharged?: number;
  lineTaxable?: number;
  lineTax?: number;
};

async function resolveVariantId(): Promise<string> {
  if (sharedVariantId) return sharedVariantId;
  const variant = await ProductVariant.findOne({ attributes: ['id'] });
  if (!variant) throw new Error('No product_variants in DB — seed catalog first');
  sharedVariantId = variant.id;
  return sharedVariantId;
}

async function seedFullOrder(opts: SeedOrderOpts) {
  const address = await Address.create({
    userId: opts.userId,
    line1: 'Line 1',
    line2: null,
    city: 'Bengaluru',
    state: 'KA',
    country: 'IN',
    pincode: '560001',
    isDefault: true,
    createdBy: opts.userId,
    updatedBy: opts.userId,
    deletedBy: null,
  });

  const taxable = opts.lineTaxable ?? 100;
  const tax = opts.lineTax ?? 18;
  const shipping = opts.shippingCharged ?? 49;
  const walletUsed = opts.walletAmountUsed ?? 0;
  const razorpayPaid =
    opts.razorpayAmountPaid ??
    (opts.paymentMethod === 'COD' ? 0 : Math.max(0, opts.totalAmount - walletUsed));

  const order = await Order.create({
    userId: opts.userId,
    couponId: null,
    appliedCouponIds: [],
    totalAmount: opts.totalAmount,
    discountTotal: 0,
    status: ORDER_STATUS.DELIVERED,
    paymentStatus: PAYMENT_STATUS.PAID,
    paymentMethod: opts.paymentMethod,
    walletAmountUsed: walletUsed,
    pendingCashbackAmount: opts.pendingCashbackAmount ?? 0,
    cashbackCreditedAt: opts.cashbackCreditedAt ?? null,
    cashbackDiscountBearer: opts.cashbackDiscountBearer ?? null,
    cashbackVendorId: opts.cashbackVendorId ?? null,
    originalTotalAmount: opts.totalAmount,
    razorpayAmountPaid: razorpayPaid,
    shippingAddressId: address.id,
    razorpayOrderId: opts.paymentMethod === 'RAZORPAY' ? `order_${randomUUID().slice(0, 8)}` : null,
    razorpayPaymentId: opts.razorpayPaymentId ?? null,
    createdBy: opts.userId,
    updatedBy: opts.userId,
    deletedBy: null,
  });
  cleanupIds.orders.push(order.id);

  const sub = await SubOrder.create({
    orderId: order.id,
    vendorId: opts.vendorId,
    status: ORDER_STATUS.DELIVERED,
    subtotal: taxable,
    shippingCost: shipping,
    shippingDiscountAmount: 0,
    taxAmount: tax,
    taxableAmount: taxable,
    taxBreakdown: { cgst: tax / 2, sgst: tax / 2, igst: 0, total: tax, gstPercentage: 18 },
    discountAmount: 0,
    commissionAmount: 10,
    tcsAmount: 1,
    netPayoutAmount: taxable - 10 - 1,
    subtotalPaise: toPaise(taxable),
    shippingCostPaise: toPaise(shipping),
    shippingDiscountAmountPaise: 0,
    taxAmountPaise: toPaise(tax),
    taxableAmountPaise: toPaise(taxable),
    discountAmountPaise: 0,
    commissionAmountPaise: toPaise(10),
    tcsAmountPaise: toPaise(1),
    netPayoutAmountPaise: toPaise(taxable - 10 - 1),
    roundingAdjustmentPaise: 0,
    trackingId: null,
    createdBy: opts.userId,
    updatedBy: opts.userId,
    deletedBy: null,
  } as any);

  const item = await OrderItem.create({
    subOrderId: sub.id,
    variantId: await resolveVariantId(),
    productName: 'Test Item',
    quantity: 1,
    unitPrice: taxable,
    discountAmount: 0,
    taxableAmount: taxable,
    taxAmount: tax,
    taxBreakdown: { cgst: tax / 2, sgst: tax / 2, igst: 0, total: tax, gstPercentage: 18 },
    commissionAmount: 10,
    tcsAmount: 1,
    netPayoutAmount: taxable - 10 - 1,
    unitPricePaise: toPaise(taxable),
    discountAmountPaise: 0,
    taxableAmountPaise: toPaise(taxable),
    taxAmountPaise: toPaise(tax),
    commissionAmountPaise: toPaise(10),
    tcsAmountPaise: toPaise(1),
    netPayoutAmountPaise: toPaise(taxable - 10 - 1),
    createdBy: opts.userId,
    updatedBy: opts.userId,
    deletedBy: null,
  } as any);

  await CommissionLedger.create({
    vendorId: opts.vendorId,
    subOrderId: sub.id,
    saleAmount: taxable,
    commissionRate: 10,
    commissionAmount: 10,
    taxableAmount: taxable,
    discountAmount: 0,
    discountBearer: DISCOUNT_BEARER.PLATFORM,
    taxAmount: tax,
    tcsAmount: 1,
    netPayoutAmount: taxable - 10 - 1,
    shippingCollected: shipping,
    saleAmountPaise: toPaise(taxable),
    commissionAmountPaise: toPaise(10),
    taxableAmountPaise: toPaise(taxable),
    discountAmountPaise: 0,
    taxAmountPaise: toPaise(tax),
    tcsAmountPaise: toPaise(1),
    netPayoutAmountPaise: toPaise(taxable - 10 - 1),
    shippingCollectedPaise: toPaise(shipping),
    referenceType: null,
    status: COMMISSION_STATUS.PENDING,
    createdBy: opts.userId,
    updatedBy: opts.userId,
    deletedBy: null,
  });

  return { order, sub, item, address };
}

async function setPlatformReturnShippingFee(fee: number) {
  const row = await PlatformSetting.findOne({ where: { key: 'platform' } });
  if (!row) return;
  const value = { ...(row.value as Record<string, unknown>), returnShippingFee: fee };
  await row.update({ value });
}

describe('consolidated refund scenarios (seeded)', () => {
  before(async () => {
    try {
      await withTimeout(sequelize.authenticate(), 2000);
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  after(async () => {
    if (!dbReady) {
      try {
        await sequelize.close();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      for (const orderId of cleanupIds.orders) {
        const subs = await SubOrder.findAll({ where: { orderId } });
        for (const sub of subs) {
          const returns = await ReturnRequest.findAll({ where: { subOrderId: sub.id } });
          for (const rr of returns) {
            await DebitNote.destroy({ where: { returnRequestId: rr.id }, force: true });
            await CreditNote.destroy({ where: { returnRequestId: rr.id }, force: true });
          }
          await ReturnRequest.destroy({ where: { subOrderId: sub.id }, force: true });
          await CreditNote.destroy({ where: { orderId }, force: true });
          await CommissionLedger.destroy({ where: { subOrderId: sub.id }, force: true });
          await OrderItem.destroy({ where: { subOrderId: sub.id }, force: true });
          await sub.destroy({ force: true });
        }
        await Order.destroy({ where: { id: orderId }, force: true });
      }
      for (const userId of cleanupIds.users) {
        await WalletWriteOff.destroy({ where: { userId }, force: true });
        await WalletLedger.destroy({ where: { userId }, force: true });
        await Address.destroy({ where: { userId }, force: true });
        await User.destroy({ where: { id: userId }, force: true });
      }
      for (const vendorId of cleanupIds.vendors) {
        await Vendor.destroy({ where: { id: vendorId }, force: true });
      }
    } catch {
      // best-effort cleanup
    }
    try {
      await sequelize.close();
    } catch {
      /* ignore */
    }
  });

  it('1. COD DAMAGED → wallet credit includes shipping', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const { order, item } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 167,
      shippingCharged: 49,
      lineTaxable: 100,
      lineTax: 18,
    });

    const rr = await returnsService.create(customer.id, {
      orderItemId: item.id,
      reasonCode: RETURN_REASON.DAMAGED,
      reason: 'Damaged on arrival',
    });
    const approved = await returnsService.transition(rr.id, RETURN_STATUS.APPROVED, customer.id);

    assert.equal(Number(approved.shippingRefundAmount), 49);
    assert.ok(Number(approved.refundAmount) >= 167 - 0.01);
    assert.equal(approved.refundMethod, 'WALLET_CREDIT');
    assert.equal(approved.refundStatus, REFUND_STATUS.COMPLETED);

    const bal = await walletService.getBalance(customer.id);
    assert.ok(Math.abs(bal - Number(approved.refundAmount)) < 0.02);

    const credit = await CreditNote.findOne({ where: { returnRequestId: rr.id } });
    assert.ok(credit);
  });

  it('2. COD NO_LONGER_NEEDED → excludes shipping, deducts return fee', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    await setPlatformReturnShippingFee(50);
    const customer = await createCustomer();
    const vendor = await createVendor(null);
    const { item } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 167,
      shippingCharged: 49,
      lineTaxable: 100,
      lineTax: 18,
    });

    const rr = await returnsService.create(customer.id, {
      orderItemId: item.id,
      reasonCode: RETURN_REASON.NO_LONGER_NEEDED,
      reason: 'Changed mind',
    });
    const approved = await returnsService.transition(rr.id, RETURN_STATUS.APPROVED, customer.id);

    assert.equal(Number(approved.shippingRefundAmount), 0);
    assert.equal(Number(approved.returnShippingFeeAmount), 50);
    // 100 + 18 - 50 = 68
    assert.ok(Math.abs(Number(approved.refundAmount) - 68) < 0.02);
    assert.equal(await walletService.getBalance(customer.id), Number(approved.refundAmount));
  });

  it('2b. Vendor returnShippingFee override wins over platform', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    await setPlatformReturnShippingFee(50);
    const customer = await createCustomer();
    const vendor = await createVendor(25);
    const { item } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 167,
      shippingCharged: 49,
      lineTaxable: 100,
      lineTax: 18,
    });
    const rr = await returnsService.create(customer.id, {
      orderItemId: item.id,
      reasonCode: RETURN_REASON.OTHER,
      reason: 'Other',
    });
    const approved = await returnsService.transition(rr.id, RETURN_STATUS.APPROVED, customer.id);
    assert.equal(Number(approved.returnShippingFeeAmount), 25);
  });

  it('3. Razorpay return → REFUNDED only after refund.processed webhook', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const paymentId = `pay_${randomUUID().slice(0, 10)}`;
    const { order, item } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 118,
      shippingCharged: 0,
      lineTaxable: 100,
      lineTax: 18,
      razorpayPaymentId: paymentId,
      razorpayAmountPaid: 118,
    });

    const createRefund = mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_test_1');

    const rr = await returnsService.create(customer.id, {
      orderItemId: item.id,
      reasonCode: RETURN_REASON.DAMAGED,
      reason: 'Damaged',
    });
    const afterApprove = await returnsService.transition(rr.id, RETURN_STATUS.APPROVED, customer.id);
    assert.equal(afterApprove.refundStatus, REFUND_STATUS.INITIATED);
    assert.notEqual(afterApprove.status, RETURN_STATUS.REFUNDED);
    assert.equal(createRefund.mock.callCount(), 1);

    const beforeWebhook = await ReturnRequest.findByPk(rr.id);
    assert.equal(beforeWebhook!.refundStatus, REFUND_STATUS.INITIATED);

    await returnsService.markRazorpayRefundProcessed({
      razorpayRefundId: 'rfnd_test_1',
      paymentId,
      amountPaise: toPaise(Number(afterApprove.refundAmount)),
      returnRequestId: rr.id,
    });

    const afterWebhook = await ReturnRequest.findByPk(rr.id);
    assert.equal(afterWebhook!.refundStatus, REFUND_STATUS.COMPLETED);
    assert.equal(afterWebhook!.status, RETURN_STATUS.REFUNDED);
    assert.ok(await CreditNote.findOne({ where: { returnRequestId: rr.id } }));

    createRefund.mock.restore();
    void order;
  });

  it('4–5. Wallet full vs partial remainder math with debit in same txn', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    await walletService.credit(
      customer.id,
      500,
      { type: WALLET_REFERENCE_TYPE.CASHBACK, id: randomUUID() },
      'seed',
    );

    // Mirrors checkout.service.ts: razorpayRemainder = orderTotal − walletAmountUsed
    const remainder = (orderTotal: number, walletUsed: number) =>
      Math.round((orderTotal - walletUsed) * 100) / 100;
    assert.equal(remainder(200, 200), 0); // full cover → skip Razorpay order/modal
    assert.equal(remainder(200, 50), 150); // partial → Razorpay for remainder only

    // Full cover debit in same txn pattern as checkout
    await sequelize.transaction(async (txn) => {
      await walletService.debit(
        customer.id,
        200,
        { type: WALLET_REFERENCE_TYPE.ORDER, id: randomUUID() },
        'full',
        txn,
      );
    });
    assert.equal(await walletService.getBalance(customer.id), 300);

    // Partial + rollback together (wallet debit + order create share one txn)
    const before = await walletService.getBalance(customer.id);
    await assert.rejects(async () => {
      await sequelize.transaction(async (txn) => {
        await walletService.debit(
          customer.id,
          100,
          { type: WALLET_REFERENCE_TYPE.ORDER, id: randomUUID() },
          'partial',
          txn,
        );
        throw new Error('force-rollback');
      });
    });
    assert.equal(await walletService.getBalance(customer.id), before);
  });

  it('6. Split-paid return → wallet instant, Razorpay webhook-gated', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const paymentId = `pay_${randomUUID().slice(0, 10)}`;
    const { item } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 200,
      walletAmountUsed: 40,
      razorpayAmountPaid: 160,
      shippingCharged: 0,
      lineTaxable: 169.49,
      lineTax: 30.51,
      razorpayPaymentId: paymentId,
    });

    const createRefund = mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_split');

    const rr = await returnsService.create(customer.id, {
      orderItemId: item.id,
      reasonCode: RETURN_REASON.DAMAGED,
      reason: 'Damaged',
    });
    const approved = await returnsService.transition(rr.id, RETURN_STATUS.APPROVED, customer.id);

    assert.ok(Number(approved.walletRefundAmount) > 0);
    assert.ok(Number(approved.razorpayRefundAmount) > 0);
    assert.equal(approved.refundStatus, REFUND_STATUS.INITIATED);
    assert.ok((await walletService.getBalance(customer.id)) > 0);

    await returnsService.markRazorpayRefundProcessed({
      razorpayRefundId: 'rfnd_split',
      paymentId,
      amountPaise: toPaise(Number(approved.razorpayRefundAmount)),
      returnRequestId: rr.id,
    });
    const done = await ReturnRequest.findByPk(rr.id);
    assert.equal(done!.refundStatus, REFUND_STATUS.COMPLETED);

    createRefund.mock.restore();
  });

  it('7–8. VENDOR cashback credit + partial clawback write-off + full commission reverse', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 118,
      shippingCharged: 0,
      pendingCashbackAmount: 50,
      cashbackDiscountBearer: DISCOUNT_BEARER.VENDOR,
      cashbackVendorId: vendor.id,
      razorpayPaymentId: `pay_${randomUUID().slice(0, 8)}`,
      razorpayAmountPaid: 118,
    });

    const credited = await creditPendingCashbackForOrder(order.id);
    assert.equal(credited, true);
    assert.equal(await walletService.getBalance(customer.id), 50);

    const cost = await CommissionLedger.findOne({
      where: { subOrderId: sub.id, referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST },
    });
    assert.ok(cost);
    assert.equal(Number(cost!.commissionAmount), -50);

    // Spend most of wallet so clawback is partial
    await walletService.debit(
      customer.id,
      40,
      { type: WALLET_REFERENCE_TYPE.ORDER, id: randomUUID() },
      'spend',
    );
    assert.equal(await walletService.getBalance(customer.id), 10);

    await sequelize.transaction(async (txn) => {
      const locked = await Order.findByPk(order.id, { transaction: txn, lock: txn.LOCK.UPDATE });
      await clawbackCashbackForReturn({
        order: locked!,
        returnRequestId: randomUUID(),
        actorId: customer.id,
        transaction: txn,
        refundMerchandisePaise: toPaise(100),
        orderMerchandiseBeforePaise: toPaise(100),
      });
    });

    assert.equal(await walletService.getBalance(customer.id), 0);
    const writeOff = await WalletWriteOff.findOne({
      where: { userId: customer.id },
      order: [['createdAt', 'DESC']],
    });
    assert.ok(writeOff);
    assert.equal(Number(writeOff!.writtenOffAmount), 40);
    assert.equal(writeOff!.bornBy, DISCOUNT_BEARER.VENDOR);

    const reversal = await CommissionLedger.findOne({
      where: {
        subOrderId: sub.id,
        referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST_REVERSAL,
      },
    });
    assert.ok(reversal);
    assert.equal(Number(reversal!.commissionAmount), 50);
  });

  it('9. PLATFORM cashback → no CommissionLedger cost; write-off bornBy PLATFORM', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 118,
      shippingCharged: 0,
      pendingCashbackAmount: 30,
      cashbackDiscountBearer: DISCOUNT_BEARER.PLATFORM,
      razorpayPaymentId: `pay_${randomUUID().slice(0, 8)}`,
      razorpayAmountPaid: 118,
    });

    await creditPendingCashbackForOrder(order.id);
    const cost = await CommissionLedger.findOne({
      where: { subOrderId: sub.id, referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST },
    });
    assert.equal(cost, null);

    await walletService.debit(
      customer.id,
      25,
      { type: WALLET_REFERENCE_TYPE.ORDER, id: randomUUID() },
      'spend',
    );

    await sequelize.transaction(async (txn) => {
      const locked = await Order.findByPk(order.id, { transaction: txn, lock: txn.LOCK.UPDATE });
      await clawbackCashbackForReturn({
        order: locked!,
        returnRequestId: randomUUID(),
        actorId: customer.id,
        transaction: txn,
        refundMerchandisePaise: toPaise(100),
        orderMerchandiseBeforePaise: toPaise(100),
      });
    });

    const writeOff = await WalletWriteOff.findOne({
      where: { userId: customer.id },
      order: [['createdAt', 'DESC']],
    });
    assert.ok(writeOff);
    assert.equal(writeOff!.bornBy, DISCOUNT_BEARER.PLATFORM);
    assert.equal(
      await CommissionLedger.count({
        where: { subOrderId: sub.id, referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST_REVERSAL },
      }),
      0,
    );
  });

  it('10. Concurrent debit + clawback never overdraw', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    await walletService.credit(
      customer.id,
      50,
      { type: WALLET_REFERENCE_TYPE.CASHBACK, id: randomUUID() },
      'seed',
    );

    const results = await Promise.allSettled([
      walletService.debit(
        customer.id,
        40,
        { type: WALLET_REFERENCE_TYPE.ORDER, id: randomUUID() },
        'a',
      ),
      walletService.clawback(
        customer.id,
        40,
        { type: WALLET_REFERENCE_TYPE.CLAWBACK, id: randomUUID() },
        'b',
        DISCOUNT_BEARER.PLATFORM,
      ),
    ]);

    const bal = await walletService.getBalance(customer.id);
    assert.ok(bal >= 0);
    assert.ok(bal <= 50);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    assert.ok(fulfilled >= 1);

    const debits = await WalletLedger.findAll({
      where: { userId: customer.id, type: 'DEBIT' },
    });
    const debitSum = debits.reduce((s, row) => s + Number(row.amount), 0);
    assert.ok(debitSum <= 50.001);
    assert.equal(Math.round((50 - debitSum) * 100) / 100, bal);
  });
});
