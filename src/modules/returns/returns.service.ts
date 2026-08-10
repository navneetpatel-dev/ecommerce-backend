import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import {
  COMMISSION_STATUS,
  DOCUMENT_SEQUENCE_KIND,
  ORDER_STATUS,
  PAYMENT_METHOD,
  REFUND_METHOD,
  REFUND_STATUS,
  RETURN_STATUS,
  WALLET_REFERENCE_TYPE,
  type ReturnReason,
  type ReturnStatus,
} from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { User } from '@database/models/user.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { CreditNote } from '@database/models/creditNote.model';
import { DebitNote } from '@database/models/debitNote.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { fromPaise, toPaise } from '@modules/pricing/money';
import { pricingService } from '@modules/pricing/pricing.service';
import { nextDocumentNumber } from '@modules/pricing/documentSequence';
import { notificationsService } from '@modules/notifications/notifications.service';
import { settingsService } from '@modules/settings/settings.service';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import { clawbackCashbackForReturn } from '@modules/wallet/cashback.service';
import { paymentsService } from '@modules/payments/payments.service';
import {
  cascadeDeleteEntityMedia,
  S3_ENTITY_TYPES,
} from '@core/s3';

const returnListInclude = [
  { model: OrderItem, as: 'orderItem', required: false, attributes: ['id', 'productName'] },
  { model: User, as: 'user', required: false, attributes: ['id', 'name'] },
];

type CreateReturnInput = {
  orderItemId: string;
  reasonCode: ReturnReason;
  reason: string;
  photoUrls?: string[];
};

const ALLOWED_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  [RETURN_STATUS.REQUESTED]: [RETURN_STATUS.APPROVED, RETURN_STATUS.REJECTED],
  [RETURN_STATUS.APPROVED]: [
    RETURN_STATUS.PICKUP_SCHEDULED,
    RETURN_STATUS.REFUNDED,
    RETURN_STATUS.REJECTED,
  ],
  [RETURN_STATUS.PICKUP_SCHEDULED]: [RETURN_STATUS.RECEIVED, RETURN_STATUS.REFUNDED],
  [RETURN_STATUS.RECEIVED]: [RETURN_STATUS.REFUNDED, RETURN_STATUS.CLOSED],
  [RETURN_STATUS.REFUNDED]: [RETURN_STATUS.PICKUP_SCHEDULED, RETURN_STATUS.RECEIVED, RETURN_STATUS.CLOSED],
  [RETURN_STATUS.REJECTED]: [],
  [RETURN_STATUS.CLOSED]: [],
};

const RESOLVED_BY_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.REJECTED,
  RETURN_STATUS.REFUNDED,
  RETURN_STATUS.CLOSED,
];
const RESOLVED_AT_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.REJECTED,
  RETURN_STATUS.REFUNDED,
  RETURN_STATUS.CLOSED,
];

const returnLockInclude = [
  {
    model: OrderItem,
    as: 'orderItem',
    include: [
      {
        model: SubOrder,
        as: 'subOrder',
        include: [{ model: OrderItem, as: 'items' }],
      },
    ],
  },
];

/**
 * Postgres rejects FOR UPDATE on the nullable side of an OUTER JOIN.
 * Lock the return row alone, then load associations without a lock.
 */
async function findReturnForUpdate(id: string, t: Transaction): Promise<ReturnRequest | null> {
  const locked = await ReturnRequest.findByPk(id, {
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!locked) return null;
  return ReturnRequest.findByPk(id, {
    include: returnLockInclude,
    transaction: t,
  });
}

function serializeReturn(row: ReturnRequest | (ReturnRequest & { orderItem?: OrderItem })) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    orderItemId: plain.orderItemId,
    reason: plain.reason,
    reasonCode: plain.reasonCode,
    status: plain.status,
    photoUrls: Array.isArray(plain.photoUrls) ? plain.photoUrls : [],
    refundMethod: plain.refundMethod ?? null,
    refundStatus: plain.refundStatus ?? REFUND_STATUS.NONE,
    refundAmount: plain.refundAmount != null ? Number(plain.refundAmount) : null,
    refundTaxAmount: plain.refundTaxAmount != null ? Number(plain.refundTaxAmount) : null,
    refundCommissionAmount:
      plain.refundCommissionAmount != null ? Number(plain.refundCommissionAmount) : null,
    refundTcsAmount: plain.refundTcsAmount != null ? Number(plain.refundTcsAmount) : null,
    refundNetClawback: plain.refundNetClawback != null ? Number(plain.refundNetClawback) : null,
    walletRefundAmount: Number(plain.walletRefundAmount ?? 0),
    razorpayRefundAmount: Number(plain.razorpayRefundAmount ?? 0),
    shippingRefundAmount: Number(plain.shippingRefundAmount ?? 0),
    returnShippingFeeAmount: Number(plain.returnShippingFeeAmount ?? 0),
    razorpayRefundId: plain.razorpayRefundId ?? null,
    receivedAt: plain.receivedAt ?? null,
    resolvedAt: plain.resolvedAt,
    createdAt: plain.createdAt,
    productName: plain.orderItem?.productName ?? null,
    customerName: plain.user?.name ?? null,
  };
}

function assertTransition(from: ReturnStatus, to: ReturnStatus) {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ValidationError(ERROR_MESSAGES.RETURN_INVALID_TRANSITION);
  }
}

async function resolveReturnShippingFeePaise(vendorId: string | null | undefined): Promise<number> {
  const settings = await settingsService.getPlatformSettings();
  let fee = Number(settings.returnShippingFee ?? 0);
  if (vendorId) {
    const vendor = await Vendor.findByPk(vendorId);
    if (vendor?.returnShippingFee != null && Number.isFinite(Number(vendor.returnShippingFee))) {
      fee = Number(vendor.returnShippingFee);
    }
  }
  return toPaise(fee);
}

export class ReturnsService {
  async listForUser(userId: string) {
    const rows = await ReturnRequest.findAll({
      where: { userId },
      include: returnListInclude,
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) => serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }));
  }

  async listAll(query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await ReturnRequest.findAndCountAll({
      include: returnListInclude,
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    return {
      returns: rows.map((row) => serializeReturn(row as ReturnRequest & { orderItem?: OrderItem })),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async create(userId: string, data: CreateReturnInput) {
    return sequelize.transaction(async (t: Transaction) => {
      const orderItem = await OrderItem.findByPk(data.orderItemId, {
        include: [
          {
            model: SubOrder,
            as: 'subOrder',
            include: [{ model: Order, as: 'order' }],
          },
        ],
        transaction: t,
      });

      if (!orderItem) throw new NotFoundError('OrderItem');

      const item = orderItem as OrderItem & {
        subOrder: SubOrder & { order: Order };
      };

      if (item.subOrder.order.userId !== userId) {
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_ORDER);
      }
      if (item.subOrder.status !== ORDER_STATUS.DELIVERED) {
        throw new ForbiddenError(ERROR_MESSAGES.ITEM_MUST_BE_DELIVERED);
      }

      const settings = await settingsService.getPlatformSettings();
      const windowDays = Number(settings.defaultReturnWindow ?? 7);
      const deliveredAt = item.subOrder.updatedAt;
      if (deliveredAt) {
        const expires = new Date(deliveredAt.getTime() + windowDays * 24 * 60 * 60 * 1000);
        if (Date.now() > expires.getTime()) {
          throw new ValidationError(ERROR_MESSAGES.RETURN_WINDOW_EXPIRED);
        }
      }

      const existing = await ReturnRequest.findOne({
        where: { orderItemId: data.orderItemId },
        transaction: t,
      });
      if (existing) {
        throw new ValidationError(ERROR_MESSAGES.RETURN_ALREADY_EXISTS);
      }

      const created = await ReturnRequest.create(
        {
          subOrderId: item.subOrderId,
          orderItemId: data.orderItemId,
          userId,
          reason: data.reason,
          reasonCode: data.reasonCode,
          photoUrls: data.photoUrls ?? [],
          status: RETURN_STATUS.REQUESTED,
          refundStatus: REFUND_STATUS.NONE,
          refundAmount: null,
          resolvedById: null,
          resolvedAt: null,
          createdBy: userId,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction: t },
      );

      return serializeReturn(created as ReturnRequest & { orderItem?: OrderItem });
    });
  }

  /**
   * Freeze vendor accounting on approval (DebitNote + commission clawback).
   * Customer CreditNote is deferred until refund track completes (REFUNDED).
   */
  private async freezeVendorAccountingOnApprove(
    row: ReturnRequest,
    actorId: string,
    t: Transaction,
  ): Promise<{
    reversal: ReturnType<typeof pricingService.reverseLineFromFrozen>;
    order: Order;
    orderItem: OrderItem & { subOrder: SubOrder & { orderId: string; vendorId: string | null } };
  }> {
    const orderItem = (row as any).orderItem as OrderItem & {
      subOrder: SubOrder & { items?: OrderItem[]; orderId: string; vendorId: string | null };
    };
    if (!orderItem?.subOrder) {
      throw new NotFoundError('OrderItem');
    }

    const order = await Order.findByPk(orderItem.subOrder.orderId, { transaction: t });
    if (!order) throw new NotFoundError('Order');

    const priorShippingRefund = await ReturnRequest.findOne({
      where: {
        subOrderId: orderItem.subOrderId,
        id: { [Op.ne]: row.id },
        shippingRefundAmount: { [Op.gt]: 0 },
      },
      transaction: t,
    });

    const shippingChargedPaise = Math.max(
      0,
      Number(orderItem.subOrder.shippingCostPaise ?? 0) -
        Number(orderItem.subOrder.shippingDiscountAmountPaise ?? 0),
    );
    const returnShippingFeePaise = await resolveReturnShippingFeePaise(orderItem.subOrder.vendorId);

    const frozen = pricingService.frozenLineFromOrderItem({
      id: orderItem.id,
      quantity: Number(orderItem.quantity),
      unitPrice: Number(orderItem.unitPrice),
      discountAmount: Number(orderItem.discountAmount ?? 0),
      taxableAmount: Number(orderItem.taxableAmount ?? 0),
      taxAmount: Number(orderItem.taxAmount ?? 0),
      taxBreakdown: (orderItem.taxBreakdown as any) ?? null,
      commissionAmount: Number(orderItem.commissionAmount ?? 0),
      tcsAmount: Number(orderItem.tcsAmount ?? 0),
      netPayoutAmount: Number(orderItem.netPayoutAmount ?? 0),
      unitPricePaise: Number(orderItem.unitPricePaise ?? 0),
      discountAmountPaise: Number(orderItem.discountAmountPaise ?? 0),
      taxableAmountPaise: Number(orderItem.taxableAmountPaise ?? 0),
      taxAmountPaise: Number(orderItem.taxAmountPaise ?? 0),
      commissionAmountPaise: Number(orderItem.commissionAmountPaise ?? 0),
      tcsAmountPaise: Number(orderItem.tcsAmountPaise ?? 0),
      netPayoutAmountPaise: Number(orderItem.netPayoutAmountPaise ?? 0),
    });

    const reversal = pricingService.reverseLineFromFrozen(frozen, Number(orderItem.quantity), {
      reasonCode: row.reasonCode,
      shippingChargedPaise,
      returnShippingFeePaise,
      shippingAlreadyRefunded: Boolean(priorShippingRefund),
    });

    const vendorId = orderItem.subOrder.vendorId;
    if (vendorId) {
      const existingDebit = await DebitNote.findOne({
        where: { returnRequestId: row.id },
        transaction: t,
      });
      if (!existingDebit) {
        const dnNumber = await nextDocumentNumber(DOCUMENT_SEQUENCE_KIND.DEBIT_NOTE, t);
        await DebitNote.create(
          {
            number: dnNumber,
            returnRequestId: row.id,
            orderId: orderItem.subOrder.orderId,
            orderItemId: orderItem.id,
            vendorId,
            commissionPaise: reversal.refundCommissionPaise,
            tcsPaise: reversal.refundTcsPaise,
            netClawbackPaise: reversal.refundNetClawbackPaise,
            reason: row.reason ?? row.reasonCode ?? null,
            issuedAt: new Date(),
            createdBy: actorId,
            updatedBy: actorId,
            deletedBy: null,
          },
          { transaction: t },
        );
      }
    }

    const sub = orderItem.subOrder;
    const nextSubtotalPaise = Math.max(0, Number(sub.subtotalPaise ?? 0) - reversal.refundSubtotalPaise);
    const nextDiscountPaise = Math.max(
      0,
      Number(sub.discountAmountPaise ?? 0) - reversal.refundDiscountPaise,
    );
    const nextTaxablePaise = Math.max(
      0,
      Number(sub.taxableAmountPaise ?? 0) - reversal.refundMerchandisePaise,
    );
    const nextTaxPaise = Math.max(0, Number(sub.taxAmountPaise ?? 0) - reversal.refundTaxPaise);
    const nextCommissionPaise = Math.max(
      0,
      Number(sub.commissionAmountPaise ?? 0) - reversal.refundCommissionPaise,
    );
    const nextTcsPaise = Math.max(0, Number(sub.tcsAmountPaise ?? 0) - reversal.refundTcsPaise);
    const nextNetPaise = Math.max(
      0,
      Number(sub.netPayoutAmountPaise ?? 0) - reversal.refundNetClawbackPaise,
    );
    await sub.update(
      {
        subtotal: fromPaise(nextSubtotalPaise),
        discountAmount: fromPaise(nextDiscountPaise),
        taxableAmount: fromPaise(nextTaxablePaise),
        taxAmount: fromPaise(nextTaxPaise),
        commissionAmount: fromPaise(nextCommissionPaise),
        tcsAmount: fromPaise(nextTcsPaise),
        netPayoutAmount: fromPaise(nextNetPaise),
        subtotalPaise: nextSubtotalPaise,
        discountAmountPaise: nextDiscountPaise,
        taxableAmountPaise: nextTaxablePaise,
        taxAmountPaise: nextTaxPaise,
        commissionAmountPaise: nextCommissionPaise,
        tcsAmountPaise: nextTcsPaise,
        netPayoutAmountPaise: nextNetPaise,
        updatedBy: actorId,
      },
      { transaction: t },
    );

    const nextOrderTotalPaise = Math.max(
      0,
      toPaise(Number(order.totalAmount)) - reversal.customerRefundPaise,
    );
    const nextDiscountTotal = Math.max(
      0,
      Number(order.discountTotal ?? 0) - fromPaise(reversal.refundDiscountPaise),
    );
    await order.update(
      {
        totalAmount: fromPaise(nextOrderTotalPaise),
        discountTotal: nextDiscountTotal,
        updatedBy: actorId,
      },
      { transaction: t },
    );

    await orderItem.update(
      {
        discountAmount: 0,
        taxableAmount: 0,
        taxAmount: 0,
        commissionAmount: 0,
        tcsAmount: 0,
        netPayoutAmount: 0,
        discountAmountPaise: 0,
        taxableAmountPaise: 0,
        taxAmountPaise: 0,
        commissionAmountPaise: 0,
        tcsAmountPaise: 0,
        netPayoutAmountPaise: 0,
        updatedBy: actorId,
      },
      { transaction: t },
    );

    const ledger = await CommissionLedger.findOne({
      where: {
        subOrderId: orderItem.subOrderId,
        referenceType: { [Op.is]: null },
      },
      transaction: t,
    });
    if (ledger) {
      const nextSale = Math.max(
        0,
        Number(ledger.saleAmount) - fromPaise(reversal.refundMerchandisePaise),
      );
      const nextCommission = Math.max(
        0,
        Number(ledger.commissionAmount) - fromPaise(reversal.refundCommissionPaise),
      );
      const nextTaxable = Math.max(
        0,
        Number(ledger.taxableAmount ?? 0) - fromPaise(reversal.refundMerchandisePaise),
      );
      const nextTcs = Math.max(0, Number(ledger.tcsAmount ?? 0) - fromPaise(reversal.refundTcsPaise));
      const nextNet = Math.max(
        0,
        Number(ledger.netPayoutAmount ?? 0) - fromPaise(reversal.refundNetClawbackPaise),
      );
      const nextTax = Math.max(0, Number(ledger.taxAmount ?? 0) - fromPaise(reversal.refundTaxPaise));
      const salePaise = Math.max(
        0,
        Number(ledger.saleAmountPaise ?? 0) - reversal.refundMerchandisePaise,
      );
      const commissionPaise = Math.max(
        0,
        Number(ledger.commissionAmountPaise ?? 0) - reversal.refundCommissionPaise,
      );
      const taxablePaise = Math.max(
        0,
        Number(ledger.taxableAmountPaise ?? 0) - reversal.refundMerchandisePaise,
      );
      const tcsPaise = Math.max(0, Number(ledger.tcsAmountPaise ?? 0) - reversal.refundTcsPaise);
      const netPaise = Math.max(
        0,
        Number(ledger.netPayoutAmountPaise ?? 0) - reversal.refundNetClawbackPaise,
      );
      const taxPaise = Math.max(0, Number(ledger.taxAmountPaise ?? 0) - reversal.refundTaxPaise);
      const discountPaise = Math.max(
        0,
        Number(ledger.discountAmountPaise ?? 0) - reversal.refundDiscountPaise,
      );
      await ledger.update(
        {
          saleAmount: nextSale,
          commissionAmount: nextCommission,
          taxableAmount: nextTaxable,
          tcsAmount: nextTcs,
          taxAmount: nextTax,
          netPayoutAmount: nextNet,
          discountAmount: fromPaise(discountPaise),
          saleAmountPaise: salePaise,
          commissionAmountPaise: commissionPaise,
          taxableAmountPaise: taxablePaise,
          tcsAmountPaise: tcsPaise,
          taxAmountPaise: taxPaise,
          netPayoutAmountPaise: netPaise,
          discountAmountPaise: discountPaise,
          status: nextNet <= 0 ? COMMISSION_STATUS.CLAWED_BACK : ledger.status,
          updatedBy: actorId,
        },
        { transaction: t },
      );
    }

    await clawbackCashbackForReturn({
      order,
      returnRequestId: row.id,
      actorId,
      transaction: t,
      refundMerchandisePaise: reversal.refundMerchandisePaise,
      orderMerchandiseBeforePaise:
        Number(orderItem.subOrder.taxableAmountPaise ?? 0) + reversal.refundMerchandisePaise,
    });

    return { reversal, order, orderItem };
  }

  private async splitRefundAmounts(
    order: Order,
    customerRefund: number,
    transaction: Transaction,
  ): Promise<{ walletRefund: number; razorpayRefund: number; refundMethod: 'RAZORPAY' | 'WALLET_CREDIT' }> {
    const walletUsed = Number(order.walletAmountUsed ?? 0);
    const isCod = order.paymentMethod === PAYMENT_METHOD.COD;
    const originalTotal = Math.max(
      Number(order.originalTotalAmount ?? 0),
      Number(order.razorpayAmountPaid ?? 0) + walletUsed,
      walletUsed,
    );

    if (isCod) {
      return {
        walletRefund: customerRefund,
        razorpayRefund: 0,
        refundMethod: REFUND_METHOD.WALLET_CREDIT,
      };
    }

    // Wallet-only checkout (no Razorpay charge).
    if (walletUsed > 0 && Number(order.razorpayAmountPaid ?? 0) <= 0 && !order.razorpayPaymentId) {
      return {
        walletRefund: customerRefund,
        razorpayRefund: 0,
        refundMethod: REFUND_METHOD.WALLET_CREDIT,
      };
    }

    if (walletUsed <= 0 || originalTotal <= 0) {
      return {
        walletRefund: 0,
        razorpayRefund: customerRefund,
        refundMethod: REFUND_METHOD.RAZORPAY,
      };
    }

    if (walletUsed >= originalTotal) {
      return {
        walletRefund: customerRefund,
        razorpayRefund: 0,
        refundMethod: REFUND_METHOD.WALLET_CREDIT,
      };
    }

    // Cap by remaining refundable pools across prior returns on this order.
    const subOrders = await SubOrder.findAll({
      where: { orderId: order.id },
      attributes: ['id'],
      transaction,
    });
    const prior = await ReturnRequest.findAll({
      where: {
        subOrderId: { [Op.in]: subOrders.map((s) => s.id) },
        refundAmount: { [Op.ne]: null },
      },
      attributes: ['walletRefundAmount', 'razorpayRefundAmount'],
      transaction,
    });
    const walletAlready = prior.reduce((s, r) => s + Number(r.walletRefundAmount ?? 0), 0);
    const razorpayAlready = prior.reduce((s, r) => s + Number(r.razorpayRefundAmount ?? 0), 0);
    const walletRemaining = Math.max(0, Math.round((walletUsed - walletAlready) * 100) / 100);
    const razorpayRemaining = Math.max(
      0,
      Math.round((Number(order.razorpayAmountPaid ?? originalTotal - walletUsed) - razorpayAlready) * 100) /
        100,
    );

    let walletShare = Math.round(((customerRefund * walletUsed) / originalTotal) * 100) / 100;
    walletShare = Math.min(walletShare, walletRemaining, customerRefund);
    let razorpayShare = Math.round((customerRefund - walletShare) * 100) / 100;
    if (razorpayShare > razorpayRemaining) {
      const overflow = razorpayShare - razorpayRemaining;
      razorpayShare = razorpayRemaining;
      walletShare = Math.min(customerRefund - razorpayShare, walletRemaining);
      void overflow;
    }

    return {
      walletRefund: walletShare,
      razorpayRefund: razorpayShare,
      refundMethod: razorpayShare > 0 ? REFUND_METHOD.RAZORPAY : REFUND_METHOD.WALLET_CREDIT,
    };
  }

  /**
   * Completes the refund track: CreditNote + REFUNDED status + notification.
   * Idempotent when already COMPLETED.
   */
  async completeRefundTrack(returnRequestId: string, actorId = 'system'): Promise<void> {
    const notifyBox: {
      payload: { userId: string; orderId: string; amount: number } | null;
    } = { payload: null };

    await sequelize.transaction(async (t) => {
      const row = await findReturnForUpdate(returnRequestId, t);
      if (!row) return;

      const orderItem = (row as any).orderItem as OrderItem & { subOrder: SubOrder };
      if (!orderItem?.subOrder) return;
      const order = await Order.findByPk(orderItem.subOrder.orderId, { transaction: t });
      if (!order) return;

      const existingCredit = await CreditNote.findOne({
        where: { returnRequestId: row.id },
        transaction: t,
      });
      // Idempotent: already finalized with CreditNote. Still allow recovery if
      // refundStatus was marked COMPLETED before CreditNote (wallet-only path).
      if (existingCredit && row.refundStatus === REFUND_STATUS.COMPLETED) {
        return;
      }

      const auditActorId = actorId === 'system' ? null : actorId;

      if (!existingCredit && row.refundAmount != null) {
        const merchandisePaise = toPaise(
          Math.max(
            0,
            Number(row.refundAmount) -
              Number(row.refundTaxAmount ?? 0) -
              Number(row.shippingRefundAmount ?? 0) +
              Number(row.returnShippingFeeAmount ?? 0),
          ),
        );
        const taxPaise = toPaise(Number(row.refundTaxAmount ?? 0));
        const totalPaise = toPaise(Number(row.refundAmount));
        const cnNumber = await nextDocumentNumber(DOCUMENT_SEQUENCE_KIND.CREDIT_NOTE, t);
        await CreditNote.create(
          {
            number: cnNumber,
            returnRequestId: row.id,
            orderId: order.id,
            orderItemId: orderItem.id,
            userId: row.userId,
            merchandisePaise,
            taxPaise,
            totalPaise,
            taxBreakdown: { refundTaxPaise: taxPaise },
            reason: row.reason ?? row.reasonCode ?? null,
            issuedAt: new Date(),
            createdBy: auditActorId,
            updatedBy: auditActorId,
            deletedBy: null,
          },
          { transaction: t },
        );
      }

      const nextStatus =
        row.status === RETURN_STATUS.CLOSED
          ? RETURN_STATUS.CLOSED
          : row.status === RETURN_STATUS.PICKUP_SCHEDULED ||
              row.status === RETURN_STATUS.RECEIVED
            ? row.status
            : RETURN_STATUS.REFUNDED;

      await row.update(
        {
          // Preserve logistics progress; only stamp REFUNDED when still at APPROVED.
          status: nextStatus,
          refundStatus: REFUND_STATUS.COMPLETED,
          resolvedById: auditActorId ?? row.resolvedById,
          resolvedAt: new Date(),
          updatedBy: auditActorId ?? row.updatedBy,
        },
        { transaction: t },
      );

      notifyBox.payload = {
        userId: order.userId,
        orderId: order.id,
        amount: Number(row.refundAmount ?? 0),
      };
    });

    if (notifyBox.payload) {
      const payload = notifyBox.payload;
      const orderNumber = payload.orderId.slice(0, 8).toUpperCase();
      void notificationsService.sendRefundProcessed(payload.userId, returnRequestId, {
        orderId: payload.orderId,
        orderNumber,
        amount: payload.amount,
      });
    }
  }

  async transition(id: string, status: ReturnStatus, actorId: string) {
    const razorpayBox: {
      refund: { returnId: string; paymentId: string; amountPaise: number } | null;
    } = { refund: null };
    let shouldCompleteRefundImmediately = false;

    const result = await sequelize.transaction(async (t: Transaction) => {
      const row = await findReturnForUpdate(id, t);
      if (!row) throw new NotFoundError('ReturnRequest');

      assertTransition(row.status, status);

      if (status === RETURN_STATUS.CLOSED && !row.receivedAt && row.status !== RETURN_STATUS.RECEIVED) {
        throw new ValidationError(ERROR_MESSAGES.RETURN_NOT_RECEIVED);
      }

      const patch: Record<string, unknown> = {
        status,
        resolvedById: RESOLVED_BY_STATUSES.includes(status) ? actorId : row.resolvedById,
        resolvedAt: RESOLVED_AT_STATUSES.includes(status) ? new Date() : row.resolvedAt,
        updatedBy: actorId,
      };

      if (status === RETURN_STATUS.RECEIVED) {
        patch.receivedAt = new Date();
      }

      if (status === RETURN_STATUS.APPROVED && row.refundAmount == null) {
        const { reversal, order } = await this.freezeVendorAccountingOnApprove(row, actorId, t);
        const customerRefund = fromPaise(reversal.customerRefundPaise);
        const split = await this.splitRefundAmounts(order, customerRefund, t);

        // Restore order.totalAmount base for split: freeze already reduced it.
        // splitRefundAmounts reconstructs original using current + refund.

        patch.refundAmount = customerRefund;
        patch.refundTaxAmount = fromPaise(reversal.refundTaxPaise);
        patch.refundCommissionAmount = fromPaise(reversal.refundCommissionPaise);
        patch.refundTcsAmount = fromPaise(reversal.refundTcsPaise);
        patch.refundNetClawback = fromPaise(reversal.refundNetClawbackPaise);
        patch.shippingRefundAmount = fromPaise(reversal.shippingRefundPaise);
        patch.returnShippingFeeAmount = fromPaise(reversal.returnShippingFeePaise);
        patch.walletRefundAmount = split.walletRefund;
        patch.razorpayRefundAmount = split.razorpayRefund;
        patch.refundMethod = split.refundMethod;
        patch.refundStatus =
          split.razorpayRefund > 0 ? REFUND_STATUS.INITIATED : REFUND_STATUS.PENDING;

        if (split.walletRefund > 0) {
          const desc =
            order.paymentMethod === PAYMENT_METHOD.COD
              ? WALLET_DESCRIPTIONS.COD_REFUND
              : WALLET_DESCRIPTIONS.WALLET_PORTION_REFUND;
          await walletService.credit(
            row.userId,
            split.walletRefund,
            {
              type:
                order.paymentMethod === PAYMENT_METHOD.COD
                  ? WALLET_REFERENCE_TYPE.COD_REFUND
                  : WALLET_REFERENCE_TYPE.WALLET_REFUND,
              id: row.id,
            },
            desc,
            t,
          );
        }

        if (split.razorpayRefund > 0) {
          if (!order.razorpayPaymentId) {
            throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_PENDING);
          }
          razorpayBox.refund = {
            returnId: row.id,
            paymentId: order.razorpayPaymentId,
            amountPaise: toPaise(split.razorpayRefund),
          };
        } else {
          shouldCompleteRefundImmediately = true;
          patch.refundStatus = REFUND_STATUS.COMPLETED;
          // Stay on APPROVED for logistics; refund track completion flips to REFUNDED after txn.
        }
      }

      if (status === RETURN_STATUS.CLOSED) {
        const received =
          Boolean(row.receivedAt) || row.status === RETURN_STATUS.RECEIVED;
        if (!received) {
          throw new ValidationError(ERROR_MESSAGES.RETURN_NOT_RECEIVED);
        }
      }

      // Manual REFUNDED transition is only for wallet-complete path / admin; Razorpay waits webhook.
      if (status === RETURN_STATUS.REFUNDED) {
        const refundStatus = String(row.refundStatus ?? REFUND_STATUS.NONE);
        if (
          Number(row.razorpayRefundAmount ?? 0) > 0 &&
          refundStatus !== REFUND_STATUS.COMPLETED
        ) {
          throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_PENDING);
        }
        patch.refundStatus = REFUND_STATUS.COMPLETED;
      }

      await row.update(patch, { transaction: t });
      return serializeReturn(row as ReturnRequest & { orderItem?: OrderItem });
    });

    const pendingRazorpay = razorpayBox.refund;
    if (pendingRazorpay) {
      try {
        const refundId = await paymentsService.createRazorpayRefund(
          pendingRazorpay.paymentId,
          pendingRazorpay.amountPaise,
          pendingRazorpay.returnId,
        );
        await ReturnRequest.update(
          { razorpayRefundId: refundId, refundStatus: REFUND_STATUS.INITIATED },
          { where: { id: pendingRazorpay.returnId } },
        );
      } catch {
        await ReturnRequest.update(
          { refundStatus: REFUND_STATUS.FAILED },
          { where: { id: pendingRazorpay.returnId } },
        );
        throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_PENDING);
      }
    }

    if (shouldCompleteRefundImmediately || status === RETURN_STATUS.REFUNDED) {
      await this.completeRefundTrack(id, actorId);
      const refreshed = await ReturnRequest.findByPk(id, { include: returnListInclude });
      if (refreshed) {
        return serializeReturn(refreshed as ReturnRequest & { orderItem?: OrderItem });
      }
    }

    const orderItem = await OrderItem.findByPk(result.orderItemId, {
      include: [{ model: SubOrder, as: 'subOrder', include: [{ model: Order, as: 'order' }] }],
    });
    const order = (orderItem as any)?.subOrder?.order as Order | undefined;
    if (order?.userId) {
      const orderNumber = order.id.slice(0, 8).toUpperCase();
      if (
        status === RETURN_STATUS.APPROVED ||
        status === RETURN_STATUS.CLOSED ||
        status === RETURN_STATUS.PICKUP_SCHEDULED ||
        status === RETURN_STATUS.RECEIVED
      ) {
        void notificationsService.sendOrderReturned(order.userId, result.id, {
          orderId: order.id,
          orderNumber,
          status,
        });
      }
    }

    return result;
  }

  /** Called from refund.processed webhook — flips refund track when Razorpay portion settles. */
  async markRazorpayRefundProcessed(input: {
    razorpayRefundId?: string;
    paymentId: string;
    amountPaise: number;
    returnRequestId?: string | null;
  }): Promise<void> {
    let returnRow: ReturnRequest | null = null;

    if (input.returnRequestId) {
      returnRow = await ReturnRequest.findByPk(input.returnRequestId);
    }

    if (!returnRow && input.razorpayRefundId) {
      returnRow = await ReturnRequest.findOne({
        where: { razorpayRefundId: input.razorpayRefundId },
      });
    }

    if (!returnRow) {
      const order = await Order.findOne({ where: { razorpayPaymentId: input.paymentId } });
      if (!order) return;

      const subOrders = await SubOrder.findAll({
        where: { orderId: order.id },
        attributes: ['id'],
      });
      const subOrderIds = subOrders.map((s) => s.id);
      if (subOrderIds.length === 0) return;

      returnRow = await ReturnRequest.findOne({
        where: {
          subOrderId: { [Op.in]: subOrderIds },
          refundStatus: { [Op.in]: [REFUND_STATUS.PENDING, REFUND_STATUS.INITIATED] },
          razorpayRefundAmount: { [Op.gt]: 0 },
        },
        order: [['updatedAt', 'DESC']],
      });
    }

    if (!returnRow) return;

    if (input.razorpayRefundId && returnRow.razorpayRefundId !== input.razorpayRefundId) {
      await returnRow.update({ razorpayRefundId: input.razorpayRefundId });
    }

    await this.completeRefundTrack(returnRow.id, 'system');
  }

  /** Soft-delete a return and cascade S3 photos (prefix + referenced URLs). */
  async delete(returnId: string, actorUserId: string) {
    const row = await ReturnRequest.findByPk(returnId);
    if (!row) throw new NotFoundError('ReturnRequest');

    const photoUrls = Array.isArray(row.photoUrls) ? row.photoUrls : [];
    await row.update({ deletedBy: actorUserId });
    await row.destroy();
    await cascadeDeleteEntityMedia(S3_ENTITY_TYPES.RETURNS, returnId, photoUrls);
  }
}

export const returnsService = new ReturnsService();
