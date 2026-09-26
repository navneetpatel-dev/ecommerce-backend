/**
 * Seeded verification of consolidated_refund_prompt scenarios against real DB + services.
 * Skips the whole suite if Postgres is unreachable within 2s.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Op } from 'sequelize';
import { sequelize } from '@database/models';
import { ensureTestRoles } from '../../../testHelpers/ensureTestRoles';
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
import { ValidationError } from '@core/errors/ValidationError';
import { DebitNote } from '@database/models/debitNote.model';
import { Address } from '@database/models/address.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { resolveReturnWindowForCategory } from '@modules/products/pdpPolicy';
import { PlatformSetting } from '@database/models/platformSetting.model';
import { walletService } from '@modules/wallet/wallet.service';
import { returnsService } from '@modules/returns/returns.service';
import { paymentsService } from '@modules/payments/payments.service';
import {
  creditPendingCashbackForOrder,
  clawbackCashbackForReturn,
  ordersDueForCashbackCredit,
} from '@modules/wallet/cashback.service';
import { env } from '@config/env';
import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { getReportDefinition } from '@modules/reports/engine/reportRegistry';
import { shippingInvoiceLine, unissuedPlatformInvoice } from '@modules/pricing/platformFeeInvoice';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { gstPeriodOf } from '@modules/pricing/gstPeriod';
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
  WALLET_POINT_SOURCE,
  WALLET_LEDGER_TYPE,
} from '@core/constants/statuses';
import { toPaise } from '@modules/pricing/money';
import {
  rollbackOrderWalletIfNeeded,
  hasWalletRollbackCredit,
} from '@modules/wallet/walletOrderRollback';
import { cancelPaidOrder } from '@modules/orders/ordersCancel.service';
import { subordersService } from '@modules/suborders/suborders.service';
import { shippingService } from '@modules/shipping/shipping.service';
import { Shipment } from '@database/models/shipment.model';

let dbReady = false;
let sharedVariantId: string | null = null;
const cleanupShipments: string[] = [];
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
  /** Units on the single order line (default 1); taxable and tax are for all of them. */
  lineQuantity?: number;
};

/**
 * A variant whose category accepts returns. Picking an arbitrary first row made the
 * suite pass or fail by heap order: seed data has categories with returns disabled.
 */
async function resolveVariantId(): Promise<string> {
  if (sharedVariantId) return sharedVariantId;
  const variants = await ProductVariant.findAll({
    attributes: ['id'],
    include: [{ model: Product, as: 'product', attributes: ['categoryId'], required: true }],
    order: [['id', 'ASC']],
    limit: 200,
  });
  for (const variant of variants) {
    const categoryId = (variant as ProductVariant & { product?: Product }).product?.categoryId;
    if ((await resolveReturnWindowForCategory(categoryId)).returnsAllowed) {
      sharedVariantId = variant.id;
      return sharedVariantId;
    }
  }
  throw new Error('No returnable product_variants in DB — seed catalog first');
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
    quantity: opts.lineQuantity ?? 1,
    unitPrice: taxable / (opts.lineQuantity ?? 1),
    discountAmount: 0,
    taxableAmount: taxable,
    taxAmount: tax,
    taxBreakdown: { cgst: tax / 2, sgst: tax / 2, igst: 0, total: tax, gstPercentage: 18 },
    commissionAmount: 10,
    tcsAmount: 1,
    netPayoutAmount: taxable - 10 - 1,
    unitPricePaise: toPaise(taxable) / (opts.lineQuantity ?? 1),
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

/** An issued platform shipping invoice on a part, as dispatch leaves it. */
async function issueShippingInvoice(sub: SubOrder, chargedRupees: number) {
  const invoice = {
    ...unissuedPlatformInvoice([shippingInvoiceLine(toPaise(chargedRupees), true)], true),
    invoiceNumber: `SHIP/TEST/${randomUUID().slice(0, 8)}`,
    issuedAt: new Date().toISOString(),
  };
  await sub.update({ shippingInvoiceSnapshot: invoice });
  return invoice;
}

/** A second part (sub-order) on the seeded order, copied from the first. */
async function addSiblingPart(sub: SubOrder, fields: Record<string, unknown>): Promise<SubOrder> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...plain } = sub.get({ plain: true }) as Record<
    string,
    unknown
  >;
  return SubOrder.create({
    ...plain,
    taxInvoiceNumber: null,
    taxInvoiceSnapshot: null,
    ...fields,
  } as never);
}

async function createShipment(subOrderId: string, fields: Record<string, unknown>) {
  const shipment = await Shipment.create({
    subOrderId,
    carrier: 'MANUAL',
    trackingNumber: `TRK-${randomUUID().slice(0, 8)}`,
    ...fields,
  } as never);
  cleanupShipments.push(shipment.id);
  return shipment;
}

async function assertReturnRefundPurchasedNonExpiring(userId: string, returnRequestId: string) {
  const row = await WalletLedger.findOne({
    where: {
      userId,
      referenceId: returnRequestId,
      type: WALLET_LEDGER_TYPE.CREDIT,
    },
    order: [['createdAt', 'DESC']],
  });
  assert.ok(row, 'expected a wallet credit for the return refund');
  assert.equal(row.pointSource, WALLET_POINT_SOURCE.PURCHASED);
  assert.equal(row.expiresAt, null);
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
      await ensureTestRoles();
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
      await Shipment.destroy({ where: { id: cleanupShipments }, force: true });
      for (const orderId of cleanupIds.orders) {
        const usages = await CouponUsage.findAll({ where: { orderId }, paranoid: false });
        await CouponUsage.destroy({ where: { orderId }, force: true });
        await Coupon.destroy({ where: { id: usages.map((u) => u.couponId) }, force: true });
        const subs = await SubOrder.findAll({ where: { orderId } });
        for (const sub of subs) {
          const returns = await ReturnRequest.findAll({ where: { subOrderId: sub.id } });
          for (const rr of returns) {
            await DebitNote.destroy({ where: { returnRequestId: rr.id }, force: true });
            await CreditNote.destroy({ where: { returnRequestId: rr.id }, force: true });
          }
          await ReturnRequest.destroy({ where: { subOrderId: sub.id }, force: true });
          await CreditNote.destroy({ where: { orderId }, force: true });
          await TcsLedger.destroy({ where: { orderId }, force: true });
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
    const { order, item, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 167,
      shippingCharged: 49,
      lineTaxable: 100,
      lineTax: 18,
    });
    const shippingInvoice = await issueShippingInvoice(sub, 49);

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

    const credit = await CreditNote.findOne({ where: { returnRequestId: rr.id, vendorId: vendor.id } });
    assert.ok(credit);
    // The GST split is in paise, like taxPaise, and adds up to it exactly: ₹18 tax on
    // an intra-state line is CGST ₹9 + SGST ₹9 = 900 + 900 paise (it used to store 9 + 9).
    const tb = credit.taxBreakdown as { cgst: number; sgst: number; igst: number };
    assert.equal(Number(credit.taxPaise), 1800);
    assert.deepEqual({ cgst: tb.cgst, sgst: tb.sgst, igst: tb.igst }, { cgst: 900, sgst: 900, igst: 0 });
    // The vendor's note is for the goods: ₹100 + ₹18, not the ₹167 refunded.
    assert.equal(Number(credit.totalPaise), 11800);
    // The ₹49 shipping refunded is reversed on the platform's shipping invoice.
    const shippingNote = await CreditNote.findOne({ where: { returnRequestId: rr.id, vendorId: null } });
    assert.ok(shippingNote);
    assert.equal(shippingNote.againstInvoiceNumber, shippingInvoice.invoiceNumber);
    assert.equal(Number(shippingNote.totalPaise), 4900);
    const stb = shippingNote.taxBreakdown as { cgst: number; sgst: number };
    assert.equal(stb.cgst, stb.sgst);
    await assertReturnRefundPurchasedNonExpiring(customer.id, rr.id);
  });

  it('1b. Return on a sale already paid out → pending deduction from the vendor', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const { sub, item } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 118,
      shippingCharged: 0,
      lineTaxable: 100,
      lineTax: 18,
    });
    const sale = await CommissionLedger.findOne({
      where: { subOrderId: sub.id, referenceType: null },
    });
    await sale!.update({ status: COMMISSION_STATUS.SETTLED, tdsRatePercent: 1 });
    const paidNetPaise = Number(sale!.netPayoutAmountPaise);

    const rr = await returnsService.create(customer.id, {
      orderItemId: item.id,
      reasonCode: RETURN_REASON.DAMAGED,
      reason: 'Damaged',
    });
    await returnsService.transition(rr.id, RETURN_STATUS.APPROVED, customer.id);

    // The paid record is left as paid...
    await sale!.reload();
    assert.equal(sale!.status, COMMISSION_STATUS.SETTLED);
    assert.equal(Number(sale!.netPayoutAmountPaise), paidNetPaise);
    // ...and the return is recovered from the vendor's next payout.
    const clawback = await CommissionLedger.findOne({
      where: { subOrderId: sub.id, referenceType: COMMISSION_REFERENCE_TYPE.RETURN_CLAWBACK },
    });
    assert.ok(clawback);
    assert.equal(clawback!.status, COMMISSION_STATUS.PENDING);
    assert.equal(Number(clawback!.netPayoutAmountPaise), -paidNetPaise);
    assert.equal(Number(clawback!.commissionAmountPaise), -toPaise(10));
    // The TDS withheld on the sale is given back at the rate it was withheld at.
    assert.equal(Number(clawback!.tdsRatePercent), 1);
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
    assert.equal(Number(approved.refundMerchandiseAmount), 100);
    // Stored in paise only; the rupee name reads from it.
    const stored = await ReturnRequest.findByPk(rr.id);
    assert.equal(Number(stored?.refundMerchandiseAmountPaise), 10000);
    // 100 + 18 - 50 = 68
    assert.ok(Math.abs(Number(approved.refundAmount) - 68) < 0.02);
    assert.equal(await walletService.getBalance(customer.id), Number(approved.refundAmount));
    await assertReturnRefundPurchasedNonExpiring(customer.id, rr.id);
    // The ₹50 fee kept is the platform's supply: its own invoice, GST included.
    const feeInvoice = (await ReturnRequest.findByPk(rr.id))!.returnFeeInvoiceSnapshot;
    assert.ok(feeInvoice?.invoiceNumber);
    assert.equal(feeInvoice.totalPaise, 5000);
    assert.equal(feeInvoice.lines[0]!.cgstPaise, feeInvoice.lines[0]!.sgstPaise);
  });

  it('2c. Return fee larger than the refund keeps the engine merchandise figure', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    await setPlatformReturnShippingFee(150);
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

    // 100 + 18 − 150 clamps to 0. Backing merchandise out of the total would give
    // 0 − 18 − 0 + 150 = 132; the stored engine value is the real 100.
    assert.equal(Number(approved.refundAmount), 0);
    assert.equal(Number(approved.refundMerchandiseAmount), 100);
    // Only the ₹118 actually kept is invoiced as the fee, not the ₹150 set.
    const feeInvoice = (await ReturnRequest.findByPk(rr.id))!.returnFeeInvoiceSnapshot;
    assert.equal(feeInvoice?.totalPaise, 11800);
    await setPlatformReturnShippingFee(50);
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
    await assertReturnRefundPurchasedNonExpiring(customer.id, rr.id);
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

  it('3b. Credit note is refused, not issued for ₹0, when approval amounts are missing', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const paymentId = `pay_${randomUUID().slice(0, 10)}`;
    const { item } = await seedFullOrder({
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
    const createRefund = mock.method(paymentsService, 'createRazorpayRefund', async () => 'rfnd_test_3b');

    const rr = await returnsService.create(customer.id, {
      orderItemId: item.id,
      reasonCode: RETURN_REASON.DAMAGED,
      reason: 'Damaged',
    });
    const approved = await returnsService.transition(rr.id, RETURN_STATUS.APPROVED, customer.id);
    // Simulate an approval that never froze its merchandise figure.
    await ReturnRequest.update({ refundMerchandiseAmountPaise: null }, { where: { id: rr.id } });

    await assert.rejects(
      returnsService.markRazorpayRefundProcessed({
        razorpayRefundId: 'rfnd_test_3b',
        paymentId,
        amountPaise: toPaise(Number(approved.refundAmount)),
        returnRequestId: rr.id,
      }),
      (err: unknown) => err instanceof ValidationError,
    );
    assert.equal(await CreditNote.count({ where: { returnRequestId: rr.id } }), 0);

    createRefund.mock.restore();
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
    await assertReturnRefundPurchasedNonExpiring(customer.id, rr.id);

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
    // Pending, so the next payout run deducts it from the vendor.
    assert.equal(cost!.status, COMMISSION_STATUS.PENDING);

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
    assert.equal(reversal!.status, COMMISSION_STATUS.PENDING);
  });

  it('8b. Return before cashback is credited shrinks it by the share returned', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const { order, item } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 236,
      shippingCharged: 0,
      lineTaxable: 200,
      lineTax: 36,
      lineQuantity: 2,
      pendingCashbackAmount: 50,
      cashbackDiscountBearer: DISCOUNT_BEARER.VENDOR,
      cashbackVendorId: vendor.id,
    });

    // One of the two units comes back before the cashback delay has passed.
    const rr = await returnsService.create(customer.id, {
      orderItemId: item.id,
      reasonCode: RETURN_REASON.DAMAGED,
      reason: 'Damaged',
      returnQuantity: 1,
    });
    await returnsService.transition(rr.id, RETURN_STATUS.APPROVED, customer.id);
    const afterReturn = await Order.findByPk(order.id);
    assert.equal(Number(afterReturn!.pendingCashbackAmount), 25);

    const balanceBefore = await walletService.getBalance(customer.id);
    assert.equal(await creditPendingCashbackForOrder(order.id), true);
    // Half the merchandise was kept, so half the cashback is paid — not all ₹50.
    assert.equal(await walletService.getBalance(customer.id), balanceBefore + 25);
    const cost = await CommissionLedger.findOne({
      where: {
        vendorId: vendor.id,
        referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST,
      },
    });
    assert.equal(Number(cost!.commissionAmount), -25);
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

  it('11. clawback writes pointSourceBreakdown on partial recover', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    await walletService.credit(
      customer.id,
      60,
      { type: WALLET_REFERENCE_TYPE.CASHBACK, id: randomUUID() },
      'promo',
      undefined,
      { pointSource: 'PROMOTIONAL' as const },
    );
    await walletService.credit(
      customer.id,
      40,
      { type: WALLET_REFERENCE_TYPE.TOPUP, id: randomUUID() },
      'purchased',
      undefined,
      { pointSource: 'PURCHASED' as const },
    );

    const result = await walletService.clawback(
      customer.id,
      50,
      { type: WALLET_REFERENCE_TYPE.CLAWBACK, id: randomUUID() },
      'clawback test',
      DISCOUNT_BEARER.PLATFORM,
    );

    assert.ok(result.ledger);
    const breakdown = result.ledger!.pointSourceBreakdown as {
      promotional?: number;
      purchased?: number;
    };
    assert.equal(breakdown.promotional, 50);
    assert.equal(breakdown.purchased, 0);
  });

  it('12. ambiguous refund webhook does not complete wrong return', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const paymentId = `pay_${randomUUID().slice(0, 10)}`;
    const { order, sub, item } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 400,
      razorpayAmountPaid: 400,
      shippingCharged: 0,
      lineTaxable: 169.49,
      lineTax: 30.51,
      razorpayPaymentId: paymentId,
    });

    const item2 = await OrderItem.create({
      subOrderId: sub.id,
      variantId: await resolveVariantId(),
      productName: 'Test Item 2',
      quantity: 1,
      unitPrice: 169.49,
      discountAmount: 0,
      taxableAmount: 169.49,
      taxAmount: 30.51,
      taxBreakdown: { cgst: 15.25, sgst: 15.26, igst: 0, total: 30.51, gstPercentage: 18 },
      commissionAmount: 10,
      tcsAmount: 1,
      netPayoutAmount: 158.49,
      unitPricePaise: toPaise(169.49),
      discountAmountPaise: 0,
      taxableAmountPaise: toPaise(169.49),
      taxAmountPaise: toPaise(30.51),
      commissionAmountPaise: toPaise(10),
      tcsAmountPaise: toPaise(1),
      netPayoutAmountPaise: toPaise(158.49),
      createdBy: customer.id,
      updatedBy: customer.id,
      deletedBy: null,
    } as any);

    const createRefund = mock.method(paymentsService, 'createRazorpayRefund', async () => `rfnd_${randomUUID().slice(0, 8)}`);

    const rrA = await returnsService.create(customer.id, {
      orderItemId: item.id,
      reasonCode: RETURN_REASON.DAMAGED,
      reason: 'Damaged A',
    });
    const rrB = await returnsService.create(customer.id, {
      orderItemId: item2.id,
      reasonCode: RETURN_REASON.DAMAGED,
      reason: 'Damaged B',
    });
    const approvedA = await returnsService.transition(rrA.id, RETURN_STATUS.APPROVED, customer.id);
    const approvedB = await returnsService.transition(rrB.id, RETURN_STATUS.APPROVED, customer.id);

    const refundPaise = toPaise(Number(approvedA.razorpayRefundAmount));
    assert.equal(refundPaise, toPaise(Number(approvedB.razorpayRefundAmount)));

    await returnsService.markRazorpayRefundProcessed({
      paymentId,
      amountPaise: refundPaise,
    });

    const afterAmbiguousA = await ReturnRequest.findByPk(rrA.id);
    const afterAmbiguousB = await ReturnRequest.findByPk(rrB.id);
    assert.equal(afterAmbiguousA!.refundStatus, REFUND_STATUS.INITIATED);
    assert.equal(afterAmbiguousB!.refundStatus, REFUND_STATUS.INITIATED);

    await returnsService.markRazorpayRefundProcessed({
      paymentId,
      amountPaise: refundPaise,
      returnRequestId: rrB.id,
      razorpayRefundId: 'rfnd_target_b',
    });

    const doneB = await ReturnRequest.findByPk(rrB.id);
    const stillA = await ReturnRequest.findByPk(rrA.id);
    assert.equal(doneB!.refundStatus, REFUND_STATUS.COMPLETED);
    assert.equal(stillA!.refundStatus, REFUND_STATUS.INITIATED);

    void order;
    createRefund.mock.restore();
  });

  it('13. wallet rollback restores promo+purchased once; second call no-ops', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    await walletService.credit(
      customer.id,
      40,
      { type: WALLET_REFERENCE_TYPE.CASHBACK, id: randomUUID() },
      'promo seed',
      undefined,
      { pointSource: 'PROMOTIONAL' as const },
    );
    await walletService.credit(
      customer.id,
      60,
      { type: WALLET_REFERENCE_TYPE.TOPUP, id: randomUUID() },
      'purchased seed',
      undefined,
      { pointSource: 'PURCHASED' as const },
    );

    const { order } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 100,
      walletAmountUsed: 100,
      razorpayAmountPaid: 0,
      shippingCharged: 0,
      lineTaxable: 84.75,
      lineTax: 15.25,
    });

    await sequelize.transaction(async (txn) => {
      await walletService.debit(
        customer.id,
        100,
        { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id },
        'checkout spend',
        txn,
      );
    });
    assert.equal(await walletService.getBalance(customer.id), 0);

    await sequelize.transaction(async (txn) => {
      const restored = await rollbackOrderWalletIfNeeded(order, customer.id, txn);
      assert.equal(restored, true);
      assert.equal(await hasWalletRollbackCredit(order.id, txn), true);
      const again = await rollbackOrderWalletIfNeeded(order, customer.id, txn);
      assert.equal(again, false);
    });

    assert.equal(await walletService.getBalance(customer.id), 100);
    const rollbackCredits = await WalletLedger.findAll({
      where: {
        userId: customer.id,
        referenceId: order.id,
        type: 'CREDIT',
      },
    });
    assert.equal(rollbackCredits.length, 2);
    const promoCredit = rollbackCredits.find((r) => r.pointSource === 'PROMOTIONAL');
    const purchasedCredit = rollbackCredits.find((r) => r.pointSource === 'PURCHASED');
    assert.equal(Number(promoCredit?.amount), 40);
    assert.equal(Number(purchasedCredit?.amount), 60);
  });

  it('14. cancel on already-CANCELLED restores wallet once; second call no-ops', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    await walletService.credit(
      customer.id,
      80,
      { type: WALLET_REFERENCE_TYPE.TOPUP, id: randomUUID() },
      'seed',
      undefined,
      { pointSource: 'PURCHASED' as const },
    );

    const { order } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 80,
      walletAmountUsed: 80,
      razorpayAmountPaid: 0,
      shippingCharged: 0,
      lineTaxable: 67.8,
      lineTax: 12.2,
    });

    await sequelize.transaction(async (txn) => {
      await walletService.debit(
        customer.id,
        80,
        { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id },
        'checkout spend',
        txn,
      );
    });
    assert.equal(await walletService.getBalance(customer.id), 0);

    await Order.update(
      { status: ORDER_STATUS.CANCELLED, walletAmountUsed: 80 },
      { where: { id: order.id } },
    );

    await cancelPaidOrder(order.id, customer.id, false);
    assert.equal(await walletService.getBalance(customer.id), 80);

    await cancelPaidOrder(order.id, customer.id, false);
    assert.equal(await walletService.getBalance(customer.id), 80);
  });

  it('15. payment.failed path restores wallet on already-cancelled order', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const razorpayOrderId = `order_${randomUUID().slice(0, 10)}`;

    await walletService.credit(
      customer.id,
      60,
      { type: WALLET_REFERENCE_TYPE.CASHBACK, id: randomUUID() },
      'seed',
      undefined,
      { pointSource: 'PROMOTIONAL' as const },
    );

    const address = await Address.create({
      userId: customer.id,
      line1: 'Line 1',
      line2: null,
      city: 'Bengaluru',
      state: 'KA',
      country: 'IN',
      pincode: '560001',
      isDefault: true,
      createdBy: customer.id,
      updatedBy: customer.id,
      deletedBy: null,
    });

    const order = await Order.create({
      userId: customer.id,
      couponId: null,
      appliedCouponIds: [],
      totalAmount: 60,
      discountTotal: 0,
      status: ORDER_STATUS.CANCELLED,
      paymentStatus: PAYMENT_STATUS.FAILED,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      walletAmountUsed: 60,
      pendingCashbackAmount: 0,
      cashbackCreditedAt: null,
      cashbackDiscountBearer: null,
      cashbackVendorId: null,
      originalTotalAmount: 60,
      razorpayAmountPaid: 60,
      shippingAddressId: address.id,
      razorpayOrderId,
      razorpayPaymentId: null,
      createdBy: customer.id,
      updatedBy: customer.id,
      deletedBy: null,
    });
    cleanupIds.orders.push(order.id);

    await sequelize.transaction(async (txn) => {
      await walletService.debit(
        customer.id,
        60,
        { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id },
        'checkout spend',
        txn,
      );
    });
    assert.equal(await walletService.getBalance(customer.id), 0);

    await sequelize.transaction(async (txn) => {
      const locked = await Order.findOne({
        where: { razorpayOrderId },
        transaction: txn,
        lock: txn.LOCK.UPDATE,
      });
      assert.ok(locked);
      if (locked.status === ORDER_STATUS.CANCELLED) {
        const walletRestored = await rollbackOrderWalletIfNeeded(locked, locked.userId, txn);
        if (walletRestored) {
          await locked.update({ walletAmountUsed: 0 }, { transaction: txn });
        }
      }
    });

    assert.equal(await walletService.getBalance(customer.id), 60);
    await sequelize.transaction(async (txn) => {
      assert.equal(await hasWalletRollbackCredit(order.id, txn), true);
    });
  });

  it('16. full suborder cancellation restores wallet spend once (not the gross total)', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    await walletService.credit(
      customer.id,
      300,
      { type: WALLET_REFERENCE_TYPE.TOPUP, id: randomUUID() },
      'seed',
      undefined,
      { pointSource: 'PURCHASED' as const },
    );

    const paymentId = `pay_${randomUUID().slice(0, 10)}`;
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 1000,
      walletAmountUsed: 300,
      razorpayAmountPaid: 700,
      razorpayPaymentId: paymentId,
      shippingCharged: 0,
      lineTaxable: 847.46,
      lineTax: 152.54,
    });
    await order.update({ status: ORDER_STATUS.CONFIRMED });
    await sub.update({ status: ORDER_STATUS.CONFIRMED, customerTotal: 1000, subtotal: 1000 });

    await sequelize.transaction(async (txn) => {
      await walletService.debit(
        customer.id,
        300,
        { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id },
        'checkout spend',
        txn,
      );
    });
    assert.equal(await walletService.getBalance(customer.id), 0);
    const before = await walletService.getBalance(customer.id);

    const createRefund = mock.method(
      paymentsService,
      'createRazorpayRefund',
      async () => `rfnd_${randomUUID().slice(0, 8)}`,
    );

    await subordersService.updateStatus(sub.id, ORDER_STATUS.CANCELLED, undefined, customer.id);

    const after = await walletService.getBalance(customer.id);
    assert.equal(after - before, 300);
    assert.equal(createRefund.mock.callCount(), 1);
    const refundPaise = createRefund.mock.calls[0]?.arguments[1];
    assert.equal(refundPaise, toPaise(700));

    createRefund.mock.restore();
  });

  it('16c. a partial cancellation returns its wallet share now, the last one the rest', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    await walletService.credit(
      customer.id,
      300,
      { type: WALLET_REFERENCE_TYPE.TOPUP, id: randomUUID() },
      'seed',
      undefined,
      { pointSource: 'PURCHASED' as const },
    );
    const paymentId = `pay_${randomUUID().slice(0, 10)}`;
    // ₹1,000 order, two ₹500 parts: ₹300 from the wallet, ₹700 by Razorpay.
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 1000,
      walletAmountUsed: 300,
      razorpayAmountPaid: 700,
      razorpayPaymentId: paymentId,
      shippingCharged: 0,
      lineTaxable: 423.73,
      lineTax: 76.27,
    });
    await order.update({ status: ORDER_STATUS.CONFIRMED });
    await sub.update({ status: ORDER_STATUS.CONFIRMED, customerTotal: 500 });
    const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = sub.get({ plain: true }) as Record<
      string,
      unknown
    >;
    const sibling = await SubOrder.create({
      ...fields,
      taxInvoiceNumber: null,
      taxInvoiceSnapshot: null,
      status: ORDER_STATUS.CONFIRMED,
      customerTotal: 500,
    } as never);
    await sequelize.transaction(async (txn) => {
      await walletService.debit(
        customer.id,
        300,
        { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id },
        'checkout spend',
        txn,
      );
    });
    assert.equal(await walletService.getBalance(customer.id), 0);

    const createRefund = mock.method(
      paymentsService,
      'createRazorpayRefund',
      async () => `rfnd_${randomUUID().slice(0, 8)}`,
    );

    await subordersService.updateStatus(sub.id, ORDER_STATUS.CANCELLED, undefined, customer.id);
    // Half the order: ₹350 back to the card and ₹150 back to the wallet, now.
    assert.equal(await walletService.getBalance(customer.id), 150);

    await subordersService.updateStatus(sibling.id, ORDER_STATUS.CANCELLED, undefined, customer.id);
    // The rest of the wallet spend, not the whole ₹300 again.
    assert.equal(await walletService.getBalance(customer.id), 300);
    assert.deepEqual(
      createRefund.mock.calls.map((call) => call.arguments[1]),
      [toPaise(350), toPaise(350)],
    );

    createRefund.mock.restore();
  });

  it('16d. a parcel back undelivered (RTO) refunds like a cancellation, with a credit note', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    await walletService.credit(
      customer.id,
      300,
      { type: WALLET_REFERENCE_TYPE.TOPUP, id: randomUUID() },
      'seed',
      undefined,
      { pointSource: 'PURCHASED' as const },
    );
    const paymentId = `pay_${randomUUID().slice(0, 10)}`;
    // ₹1,000 order, two ₹500 parts: ₹300 from the wallet, ₹700 by Razorpay.
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 1000,
      walletAmountUsed: 300,
      razorpayAmountPaid: 700,
      razorpayPaymentId: paymentId,
      shippingCharged: 0,
      lineTaxable: 423.73,
      lineTax: 76.27,
    });
    await order.update({ status: ORDER_STATUS.CONFIRMED });
    const invoiceNumber = `RTO/TEST/${randomUUID().slice(0, 8)}`;
    await sub.update({
      status: ORDER_STATUS.SHIPPED,
      customerTotal: 500,
      taxInvoiceNumber: invoiceNumber,
      taxInvoiceIssuedAt: new Date(),
    });
    const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = sub.get({ plain: true }) as Record<
      string,
      unknown
    >;
    await SubOrder.create({
      ...fields,
      taxInvoiceNumber: null,
      taxInvoiceSnapshot: null,
      status: ORDER_STATUS.CONFIRMED,
      customerTotal: 500,
    } as never);
    await sequelize.transaction(async (txn) => {
      await walletService.debit(
        customer.id,
        300,
        { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id },
        'checkout spend',
        txn,
      );
    });
    const shipment = await Shipment.create({
      subOrderId: sub.id,
      carrier: 'MANUAL',
      trackingNumber: `TRK-${randomUUID().slice(0, 8)}`,
      status: 'RTO_INITIATED',
    } as never);

    const createRefund = mock.method(
      paymentsService,
      'createRazorpayRefund',
      async () => `rfnd_${randomUUID().slice(0, 8)}`,
    );
    try {
      await shippingService.applyShipmentStatus(shipment, 'RTO_DELIVERED');

      // Its ₹150 wallet share back as spent (not ₹500 of promotional points) ...
      assert.equal(await walletService.getBalance(customer.id), 150);
      const balances = await walletService.getPointSourceBalances(customer.id);
      assert.equal(balances.purchased, 150);
      // ... and its ₹350 card share back to the card.
      assert.deepEqual(
        createRefund.mock.calls.map((call) => call.arguments[1]),
        [toPaise(350)],
      );
      // The invoice issued at dispatch is reversed by a credit note.
      const notes = await CreditNote.findAll({ where: { orderId: order.id } });
      assert.equal(notes.length, 1);
      assert.equal(notes[0]!.againstInvoiceNumber, invoiceNumber);
      assert.equal(notes[0]!.returnRequestId, null);
      assert.equal(Number(notes[0]!.totalPaise), toPaise(500));
    } finally {
      createRefund.mock.restore();
      await Shipment.destroy({ where: { id: shipment.id }, force: true });
    }
  });

  it('16e. cashback is paid on the delivered part when a sibling came back undelivered (RTO)', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    // ₹200 of merchandise in two ₹100 parts, ₹20 cashback pending.
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 236,
      shippingCharged: 0,
      pendingCashbackAmount: 20,
    });
    await order.update({ merchandiseSubtotal: 200 });
    await sub.update({ customerTotal: 118 });
    const other = await addSiblingPart(sub, { status: ORDER_STATUS.SHIPPED, customerTotal: 118 });
    const shipment = await createShipment(other.id, { status: 'RTO_INITIATED' });
    await shippingService.applyShipmentStatus(shipment, 'RTO_DELIVERED');

    // Settled long enough ago: the job picks the order up although its last part was an RTO.
    await sequelize.query(
      `UPDATE sub_orders SET "updatedAt" = NOW() - make_interval(days => :days) WHERE "orderId" = :orderId`,
      { replacements: { days: env.CASHBACK_CREDIT_DELAY_DAYS + 1, orderId: order.id } },
    );
    assert.ok((await ordersDueForCashbackCredit(100_000)).includes(order.id));

    const before = await walletService.getBalance(customer.id);
    assert.equal(await creditPendingCashbackForOrder(order.id), true);
    // Half the merchandise was delivered: half the cashback.
    assert.equal(await walletService.getBalance(customer.id), before + 10);
  });

  it('16f. every part back undelivered (RTO): no cashback due, as on a full cancellation', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 118,
      shippingCharged: 0,
      pendingCashbackAmount: 20,
    });
    await order.update({ paymentStatus: PAYMENT_STATUS.PENDING, status: ORDER_STATUS.SHIPPED });
    await sub.update({ status: ORDER_STATUS.SHIPPED, customerTotal: 118 });
    const shipment = await createShipment(sub.id, { status: 'RTO_INITIATED', codAmount: 118 });
    await shippingService.applyShipmentStatus(shipment, 'RTO_DELIVERED');

    const after = await Order.findByPk(order.id);
    assert.equal(after!.status, ORDER_STATUS.RETURNED);
    assert.equal(Number(after!.pendingCashbackAmount), 0);
    // Nothing was collected: still unpaid.
    assert.equal(after!.paymentStatus, PAYMENT_STATUS.PENDING);
  });

  it('16g. a COD order is paid once its other parcel is delivered and one came back (RTO)', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    await walletService.credit(
      customer.id,
      36,
      { type: WALLET_REFERENCE_TYPE.TOPUP, id: randomUUID() },
      'seed',
      undefined,
      { pointSource: 'PURCHASED' as const },
    );
    // ₹236 in two ₹118 parts: ₹36 from the wallet, ₹200 cash on delivery (₹100 a parcel).
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 236,
      walletAmountUsed: 36,
      shippingCharged: 0,
    });
    await order.update({ paymentStatus: PAYMENT_STATUS.PENDING, status: ORDER_STATUS.SHIPPED });
    await sub.update({ status: ORDER_STATUS.SHIPPED, customerTotal: 118 });
    const other = await addSiblingPart(sub, { status: ORDER_STATUS.SHIPPED, customerTotal: 118 });
    await sequelize.transaction(async (txn) => {
      await walletService.debit(
        customer.id,
        36,
        { type: WALLET_REFERENCE_TYPE.ORDER, id: order.id },
        'checkout spend',
        txn,
      );
    });
    const delivered = await createShipment(sub.id, { status: 'OUT_FOR_DELIVERY', codAmount: 100 });
    const refused = await createShipment(other.id, { status: 'IN_TRANSIT', codAmount: 100 });

    await shippingService.applyShipmentStatus(delivered, 'DELIVERED');
    // The other parcel is still on its way: not paid yet.
    assert.equal((await Order.findByPk(order.id))!.paymentStatus, PAYMENT_STATUS.PENDING);

    await refused.update({ status: 'RTO_INITIATED' });
    await shippingService.applyShipmentStatus(refused, 'RTO_DELIVERED');
    // The refused parcel owes nothing: the cash collected is all that was due.
    assert.equal((await Order.findByPk(order.id))!.paymentStatus, PAYMENT_STATUS.PAID);
    // Its ₹18 wallet share came back.
    assert.equal(await walletService.getBalance(customer.id), 18);

    // The COD remittance report: ₹100 due (not the ₹200 checked out), ₹100 collected.
    const now = Date.now();
    const report = await getReportDefinition('cod-remittance')!.query({
      from: new Date(now - 86_400_000),
      to: new Date(now + 86_400_000),
      page: 1,
      limit: 100_000,
    });
    const row = report.rows.find((r) => r.orderId === order.id);
    assert.equal(row?.codAmount, 100);
    assert.equal(row?.codCollected, 100);
    assert.equal(row?.codStatus, 'COLLECTED');
  });

  it('16h. cancelling every part one by one gives the coupon back; an RTO does not', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();

    const seedWithCoupon = async () => {
      const coupon = await Coupon.create({
        code: `PART${randomUUID().slice(0, 8).toUpperCase()}`,
        type: 'FLAT',
        value: 20,
        config: {},
        usedCount: 1,
        startDate: new Date(Date.now() - 86_400_000),
        endDate: new Date(Date.now() + 86_400_000),
        status: 'ACTIVE',
        createdById: customer.id,
      } as never);
      const { order, sub } = await seedFullOrder({
        userId: customer.id,
        vendorId: vendor.id,
        paymentMethod: PAYMENT_METHOD.COD,
        totalAmount: 236,
        shippingCharged: 0,
      });
      await order.update({ paymentStatus: PAYMENT_STATUS.PENDING, status: ORDER_STATUS.CONFIRMED });
      await sub.update({ status: ORDER_STATUS.CONFIRMED, customerTotal: 118 });
      const other = await addSiblingPart(sub, { status: ORDER_STATUS.CONFIRMED, customerTotal: 118 });
      await CouponUsage.create({
        couponId: coupon.id,
        userId: customer.id,
        orderId: order.id,
        discountApplied: 20,
        createdBy: customer.id,
        updatedBy: customer.id,
        deletedBy: null,
      } as never);
      return { coupon, order, sub, other };
    };

    const cancelled = await seedWithCoupon();
    await subordersService.updateStatus(cancelled.sub.id, ORDER_STATUS.CANCELLED, undefined, customer.id);
    // One part still stands: the redemption stays.
    assert.equal(await CouponUsage.count({ where: { orderId: cancelled.order.id } }), 1);
    await subordersService.updateStatus(cancelled.other.id, ORDER_STATUS.CANCELLED, undefined, customer.id);
    assert.equal(await CouponUsage.count({ where: { orderId: cancelled.order.id } }), 0);
    assert.equal((await Coupon.findByPk(cancelled.coupon.id))!.usedCount, 0);

    const refused = await seedWithCoupon();
    await refused.sub.update({ status: ORDER_STATUS.RETURNED });
    await subordersService.updateStatus(refused.other.id, ORDER_STATUS.CANCELLED, undefined, customer.id);
    assert.equal(await CouponUsage.count({ where: { orderId: refused.order.id } }), 1);
    assert.equal((await Coupon.findByPk(refused.coupon.id))!.usedCount, 1);
  });

  it('16i. dispatch issues the shipping invoice and records TCS; an RTO reverses both', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.COD,
      totalAmount: 167,
      shippingCharged: 49,
    });
    await order.update({ paymentStatus: PAYMENT_STATUS.PENDING, status: ORDER_STATUS.CONFIRMED });
    await sub.update({
      status: ORDER_STATUS.CONFIRMED,
      customerTotal: 167,
      tcsAmountPaise: 50,
      tcsRatePercent: 0.5,
      shippingInvoiceSnapshot: unissuedPlatformInvoice([shippingInvoiceLine(4900, true)], true),
    });
    // Checkout records no TCS any more: nothing before dispatch.
    assert.equal(await TcsLedger.count({ where: { subOrderId: sub.id } }), 0);

    const shipment = await createShipment(sub.id, { status: 'PENDING', codAmount: 167 });
    await shippingService.applyShipmentStatus(shipment, 'PICKED_UP');
    const dispatched = await SubOrder.findByPk(sub.id);
    assert.ok(dispatched!.taxInvoiceNumber);
    const shippingInvoice = dispatched!.shippingInvoiceSnapshot;
    assert.ok(shippingInvoice?.invoiceNumber);
    const collection = await TcsLedger.findOne({ where: { subOrderId: sub.id, entryType: 'COLLECTION' } });
    assert.equal(Number(collection?.tcsAmountPaise), 50);
    assert.equal(Number(collection?.ratePercent), 0.5);
    assert.equal(collection?.period, gstPeriodOf(new Date()));
    // Equal halves: TCS on an intra-state supply is CGST + SGST.
    assert.equal(Number(collection?.tcsCgstPaise), Number(collection?.tcsSgstPaise));

    await shipment.reload();
    await shipment.update({ status: 'RTO_INITIATED' });
    await shippingService.applyShipmentStatus(shipment, 'RTO_DELIVERED');
    // The collection stays in its period; a reversal nets it out.
    const rows = await TcsLedger.findAll({ where: { subOrderId: sub.id } });
    assert.equal(rows.length, 2);
    assert.equal(rows.reduce((sum, row) => sum + Number(row.tcsAmountPaise), 0), 0);
    // The shipping invoice is reversed by a platform credit note.
    const note = await CreditNote.findOne({
      where: { orderId: order.id, vendorId: null, againstInvoiceNumber: shippingInvoice.invoiceNumber },
    });
    assert.equal(Number(note?.totalPaise), 4900);
  });

  it('16b. cancelling the last sub-order refunds the order-level gift-wrap fee too', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
    const paymentId = `pay_${randomUUID().slice(0, 10)}`;
    // Two ₹500 sub-orders plus the ₹49 gift-wrap fee, all paid through Razorpay.
    const { order, sub } = await seedFullOrder({
      userId: customer.id,
      vendorId: vendor.id,
      paymentMethod: PAYMENT_METHOD.RAZORPAY,
      totalAmount: 1049,
      razorpayAmountPaid: 1049,
      razorpayPaymentId: paymentId,
      shippingCharged: 0,
      lineTaxable: 423.73,
      lineTax: 76.27,
    });
    await order.update({ status: ORDER_STATUS.CONFIRMED, giftWrapFeeAmount: 49 } as never);
    await sub.update({ status: ORDER_STATUS.CONFIRMED, customerTotal: 500 });
    const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = sub.get({ plain: true }) as Record<
      string,
      unknown
    >;
    const sibling = await SubOrder.create({
      ...fields,
      taxInvoiceNumber: null,
      taxInvoiceSnapshot: null,
      status: ORDER_STATUS.CONFIRMED,
      customerTotal: 500,
    } as never);

    const createRefund = mock.method(
      paymentsService,
      'createRazorpayRefund',
      async () => `rfnd_${randomUUID().slice(0, 8)}`,
    );

    await subordersService.updateStatus(sub.id, ORDER_STATUS.CANCELLED, undefined, customer.id);
    await subordersService.updateStatus(sibling.id, ORDER_STATUS.CANCELLED, undefined, customer.id);

    const refunds = createRefund.mock.calls.map((call) => call.arguments[1]);
    // The first cancellation returns its ₹500; the last returns the rest, fee included.
    assert.deepEqual(refunds, [toPaise(500), toPaise(549)]);

    createRefund.mock.restore();
  });

  it('18. promo expiry takes only the unused part of expired lots, never newer points', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 30 * 86_400_000);
    const promo = (amount: number, expiresAt: Date) =>
      walletService.credit(
        customer.id,
        amount,
        { type: WALLET_REFERENCE_TYPE.CASHBACK, id: randomUUID() },
        'promo',
        undefined,
        { pointSource: WALLET_POINT_SOURCE.PROMOTIONAL, expiresAt },
      );

    // ₹100 promo, ₹60 of it spent, then it expires: only the ₹40 left goes.
    await promo(100, past);
    await walletService.debit(customer.id, 60, { type: WALLET_REFERENCE_TYPE.ORDER, id: randomUUID() }, 'spend');
    assert.equal(await walletService.expirePromotionalPoints(customer.id, new Date()), 40);
    assert.equal(await walletService.getBalance(customer.id), 0);

    // New cashback still valid: the next run leaves it alone (it used to expire it).
    await promo(50, future);
    assert.equal(await walletService.expirePromotionalPoints(customer.id, new Date()), 0);
    assert.equal(await walletService.getBalance(customer.id), 50);
  });

  it('17. return-refund wallet credit is excluded from promotional expiry sweep', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const customer = await createCustomer();
    const vendor = await createVendor();
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
      reasonCode: RETURN_REASON.DAMAGED,
      reason: 'Damaged on arrival',
    });
    await returnsService.transition(rr.id, RETURN_STATUS.APPROVED, customer.id);
    await assertReturnRefundPurchasedNonExpiring(customer.id, rr.id);

    const credit = await WalletLedger.findOne({
      where: {
        userId: customer.id,
        referenceId: rr.id,
        type: WALLET_LEDGER_TYPE.CREDIT,
      },
    });
    assert.ok(credit);
    const swept = await WalletLedger.findAll({
      where: {
        id: credit.id,
        type: WALLET_LEDGER_TYPE.CREDIT,
        pointSource: WALLET_POINT_SOURCE.PROMOTIONAL,
        expiresAt: { [Op.lte]: new Date() },
      },
    });
    assert.equal(swept.length, 0);
  });
});
