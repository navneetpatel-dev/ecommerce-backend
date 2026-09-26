import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import {
  COMMISSION_STATUS,
  ORDER_STATUS,
  PAYMENT_METHOD,
  REFUND_METHOD,
  REFUND_STATUS,
  RETURN_STATUS,
  RETURN_TYPE,
  WALLET_REFERENCE_TYPE,
  WALLET_POINT_SOURCE,
  type ReturnReason,
  type ReturnStatus,
} from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Shipment } from '@database/models/shipment.model';
import { Order } from '@database/models/order.model';
import { User } from '@database/models/user.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { CreditNote } from '@database/models/creditNote.model';
import { DebitNote } from '@database/models/debitNote.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { fromPaise, roundMoney, sumRupees, toPaise } from '@modules/pricing/money';
import { frozenPaise } from '@modules/pricing/frozenMoneySql';
import {
  lineSubtotal,
  lineTotal,
  recomputeOrderDisplayFields,
  recomputeSubOrderDisplayFields,
  scaleTaxBreakdown,
} from '@modules/pricing/displayMoney';
import { splitTaxAmount } from '@modules/pricing/pricing.engine';
import {
  isWalletFundedOrder,
  orderRazorpayPaidPaise,
  walletShareOfRefundPaise,
} from '@modules/pricing/refundSplit';
import { pricingService } from '@modules/pricing/pricing.service';
import {
  nextVendorDocumentNumber,
  VENDOR_DOCUMENT_KIND,
} from '@modules/pricing/vendorInvoiceSequence';
import { notificationsService } from '@modules/notifications/notifications.service';
import { Product } from '@database/models/product.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { settingsService } from '@modules/settings/settings.service';
import { resolveReturnWindowForCategory } from '@modules/products/pdpPolicy';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import {
  clawbackCashbackForReturn,
  shrinkPendingCashbackForReturn,
} from '@modules/wallet/cashback.service';
import { logAudit } from '@modules/audit/audit.service';
import { paymentsService } from '@modules/payments/payments.service';
import {
  cascadeDeleteEntityMedia,
  S3_ENTITY_TYPES,
} from '@core/s3';
import {
  getCreditNotePdfForActor,
  getDebitNotePdfForActor,
} from '@modules/reports/notePdf.service';

const returnListInclude = [
  { model: OrderItem, as: 'orderItem', required: false, attributes: ['id', 'productName'] },
  { model: User, as: 'user', required: false, attributes: ['id', 'name'] },
  { model: SubOrder, as: 'subOrder', required: false, attributes: ['id', 'vendorId'] },
  {
    model: CreditNote,
    as: 'creditNote',
    required: false,
    attributes: ['id', 'number', 'againstInvoiceNumber'],
  },
  {
    model: DebitNote,
    as: 'debitNote',
    required: false,
    attributes: ['id', 'number', 'againstInvoiceNumber'],
  },
];

type CreateReturnInput = {
  orderItemId: string;
  reasonCode: ReturnReason;
  reason: string;
  type: 'REFUND' | 'EXCHANGE';
  returnQuantity?: number;
  photoUrls?: string[];
};

// NOTE: REJECTED is only reachable from REQUESTED. Approving a return synchronously moves real
// money (wallet credit and/or a Razorpay refund initiation) and freezes vendor accounting — there
// is no reversal path for any of that, so an already-APPROVED return must never be rejectable.
const ALLOWED_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  [RETURN_STATUS.REQUESTED]: [RETURN_STATUS.APPROVED, RETURN_STATUS.REJECTED],
  [RETURN_STATUS.APPROVED]: [
    RETURN_STATUS.PICKUP_SCHEDULED,
    RETURN_STATUS.REFUNDED,
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

export async function persistTcsReturnAdjustmentLedger(
  params: {
    refundTcsPaise: number;
    refundMerchandisePaise: number;
    itemIgst: number;
    subOrderIgst: number;
    orderId: string;
    subOrderId: string;
    vendorId: string;
    originalTcs: {
      ratePercent?: number | null;
      vendorGstin?: string | null;
      placeOfSupplyState?: string | null;
    } | null;
    vendor: { gstNumber?: string | null; state?: string | null } | null;
    fallbackRatePercent: number;
    returnRequestId: string;
    actorId: string;
    issuedAt: Date;
  },
  transaction: Transaction,
) {
  const useIgst =
    Number(params.itemIgst ?? 0) > 0 || Number(params.subOrderIgst ?? 0) > 0;
  const { cgst: tcsCgstPaise, sgst: tcsSgstPaise, igst: tcsIgstPaise } = splitTaxAmount(
    params.refundTcsPaise,
    !useIgst,
  );
  const placeOfSupplyState =
    params.originalTcs?.placeOfSupplyState ?? params.vendor?.state ?? null;
  return TcsLedger.create(
    {
      orderId: params.orderId,
      subOrderId: params.subOrderId,
      vendorId: params.vendorId,
      taxableAmountPaise: -Math.abs(params.refundMerchandisePaise),
      ratePercent: Number(params.originalTcs?.ratePercent ?? params.fallbackRatePercent ?? 0),
      tcsAmountPaise: -params.refundTcsPaise,
      tcsCgstPaise: -tcsCgstPaise,
      tcsSgstPaise: -tcsSgstPaise,
      tcsIgstPaise: -tcsIgstPaise,
      period: params.issuedAt.toISOString().slice(0, 7),
      section: '52',
      entryType: 'RETURN_ADJUSTMENT',
      vendorGstin: params.originalTcs?.vendorGstin ?? params.vendor?.gstNumber ?? null,
      placeOfSupplyState,
      returnRequestId: params.returnRequestId,
      createdBy: params.actorId,
      updatedBy: params.actorId,
      deletedBy: null,
    },
    { transaction },
  );
}

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

function serializeReturn(
  row: ReturnRequest | (ReturnRequest & { orderItem?: OrderItem }),
  slaDays: number,
) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  const creditNote = plain.CreditNote ?? plain.creditNote ?? null;
  const debitNote = plain.DebitNote ?? plain.debitNote ?? null;
  const refundStatus = plain.refundStatus ?? REFUND_STATUS.NONE;
  let refundCustomerMessage: string | null = null;
  if (refundStatus === REFUND_STATUS.INITIATED) {
    refundCustomerMessage = `Refund initiated — bank posting may take ${slaDays} business days.`;
  } else if (refundStatus === REFUND_STATUS.FAILED) {
    refundCustomerMessage = 'There was an issue processing your bank refund. Our team is retrying.';
  } else if (refundStatus === REFUND_STATUS.COMPLETED) {
    refundCustomerMessage = 'Refund completed.';
  }
  return {
    id: plain.id,
    orderItemId: plain.orderItemId,
    subOrderId: plain.subOrderId ?? null,
    reason: plain.reason,
    reasonCode: plain.reasonCode,
    returnQuantity: plain.returnQuantity != null ? Number(plain.returnQuantity) : null,
    status: plain.status,
    type: plain.type ?? RETURN_TYPE.REFUND,
    deliveryAgentId: plain.deliveryAgentId ?? null,
    pickupOtpVerifiedAt: plain.pickupOtpVerifiedAt ?? null,
    pickupFailureReason: plain.pickupFailureReason ?? null,
    rejectionReason: plain.rejectionReason ?? null,
    preferredRepickupSlot: plain.preferredRepickupSlot ?? null,
    replacementDeliveredAt: plain.replacementDeliveredAt ?? null,
    replacementProofUrl: plain.replacementProofUrl ?? null,
    photoUrls: Array.isArray(plain.photoUrls) ? plain.photoUrls : [],
    refundMethod: plain.refundMethod ?? null,
    refundStatus: plain.refundStatus ?? REFUND_STATUS.NONE,
    refundCustomerMessage,
    refundAmount: plain.refundAmount != null ? Number(plain.refundAmount) : null,
    refundTaxAmount: plain.refundTaxAmount != null ? Number(plain.refundTaxAmount) : null,
    refundMerchandiseAmount:
      plain.refundMerchandiseAmount != null ? Number(plain.refundMerchandiseAmount) : null,
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
    creditNoteNumber: creditNote?.number ?? null,
    creditNoteId: creditNote?.id ?? null,
    debitNoteNumber: debitNote?.number ?? null,
    debitNoteId: debitNote?.id ?? null,
    againstInvoiceNumber:
      creditNote?.againstInvoiceNumber ?? debitNote?.againstInvoiceNumber ?? null,
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

async function refundSlaDays(): Promise<number> {
  const settings = await settingsService.getPlatformSettings();
  return settings.refundSlaBusinessDays;
}

export class ReturnsService {
  private async canManageRefunds(actor: {
    roleId: string;
    role: { name: string };
  }): Promise<boolean> {
    const permissions = await resolvePermissionsForUser(actor);
    return (
      permissions.includes(PERMISSIONS.ORDER_REFUND) ||
      permissions.includes(PERMISSIONS.ORDER_MANAGE)
    );
  }

  async getCreditNotePdf(
    returnId: string,
    actor: { id: string; vendorId?: string | null; roleId: string; role: { name: string } },
  ) {
    const note = await CreditNote.findOne({ where: { returnRequestId: returnId } });
    if (!note) throw new NotFoundError('CreditNote');

    return getCreditNotePdfForActor({
      noteId: note.id,
      userId: actor.id,
      vendorId: actor.vendorId,
      isAdmin: await this.canManageRefunds(actor),
    });
  }

  async getDebitNotePdf(
    returnId: string,
    actor: { vendorId?: string | null; roleId: string; role: { name: string } },
  ) {
    const note = await DebitNote.findOne({ where: { returnRequestId: returnId } });
    if (!note) throw new NotFoundError('DebitNote');

    return getDebitNotePdfForActor({
      noteId: note.id,
      vendorId: actor.vendorId,
      isAdmin: await this.canManageRefunds(actor),
    });
  }

  async listForUser(userId: string) {
    const slaDays = await refundSlaDays();
    const rows = await ReturnRequest.findAll({
      where: { userId },
      include: returnListInclude,
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) =>
      serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }, slaDays),
    );
  }

  async listAll(query: { page: number; limit: number }) {
    const slaDays = await refundSlaDays();
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
      returns: rows.map((row) =>
        serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }, slaDays),
      ),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async getById(
    id: string,
    requester: { id: string; roleId: string; role: { name: string }; vendorId?: string | null },
  ) {
    const slaDays = await refundSlaDays();
    const row = await ReturnRequest.findByPk(id, { include: returnListInclude });
    if (!row) throw new NotFoundError('ReturnRequest');

    if (row.userId === requester.id) {
      return serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }, slaDays);
    }

    const subOrder = (row as ReturnRequest & { subOrder?: { vendorId?: string } }).subOrder;
    if (requester.vendorId && subOrder?.vendorId === requester.vendorId) {
      return serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }, slaDays);
    }

    const permissions = await resolvePermissionsForUser(requester);
    if (!permissions.includes(PERMISSIONS.ORDER_REFUND)) {
      throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_RETURN);
    }

    return serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }, slaDays);
  }

  async listForVendor(vendorId: string, query: { page: number; limit: number }) {
    const slaDays = await refundSlaDays();
    const offset = paginationOffset(query.page, query.limit);
    const vendorInclude = returnListInclude.map((inc) =>
      (inc as { as?: string }).as === 'subOrder'
        ? {
            ...inc,
            required: true,
            where: { vendorId },
          }
        : inc,
    );
    const { rows, count } = await ReturnRequest.findAndCountAll({
      include: vendorInclude,
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    return {
      returns: rows.map((row) =>
        serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }, slaDays),
      ),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  /** Customer picks a repickup window after a failed attempt — mirrors shippingService.rescheduleDelivery. */
  async reschedulePickup(id: string, userId: string, slot: string) {
    const row = await ReturnRequest.findByPk(id);
    if (!row) throw new NotFoundError('ReturnRequest');
    if (row.userId !== userId) throw new ForbiddenError(ERROR_MESSAGES.NO_ACCESS_TO_RETURN);
    if (row.status !== RETURN_STATUS.PICKUP_SCHEDULED || !row.pickupFailureReason) {
      throw new ValidationError({ status: ['Only a failed pickup attempt can be rescheduled'] });
    }
    await row.update({ preferredRepickupSlot: slot, pickupFailureReason: null });
    const slaDays = await refundSlaDays();
    return serializeReturn(row, slaDays);
  }

  async create(userId: string, data: CreateReturnInput) {
    const slaDays = await refundSlaDays();
    return sequelize.transaction(async (t: Transaction) => {
      const orderItem = await OrderItem.findByPk(data.orderItemId, {
        include: [
          {
            model: SubOrder,
            as: 'subOrder',
            include: [
              { model: Order, as: 'order' },
              { model: Shipment, as: 'shipment', attributes: ['deliveredAt'] },
            ],
          },
          {
            model: ProductVariant,
            as: 'variant',
            include: [{ model: Product, as: 'product', attributes: ['id', 'categoryId'] }],
          },
        ],
        transaction: t,
      });

      if (!orderItem) throw new NotFoundError('OrderItem');

      const item = orderItem as OrderItem & {
        subOrder: SubOrder & { order: Order; shipment?: Shipment | null };
        variant?: ProductVariant & { product?: Product };
      };

      if (item.subOrder.order.userId !== userId) {
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_ORDER);
      }
      if (item.subOrder.status !== ORDER_STATUS.DELIVERED) {
        throw new ForbiddenError(ERROR_MESSAGES.ITEM_MUST_BE_DELIVERED);
      }

      const returnWindow = await resolveReturnWindowForCategory(item.variant?.product?.categoryId);
      if (!returnWindow.returnsAllowed || returnWindow.returnWindowDays == null) {
        throw new ValidationError(ERROR_MESSAGES.RETURN_NOT_ALLOWED);
      }
      const windowDays = returnWindow.returnWindowDays;
      // Prefer the real delivery timestamp (Shipment.deliveredAt, set once by the OTP-gated
      // delivery-agent confirmation) over SubOrder.updatedAt, which is a generic timestamp any
      // later, unrelated write to the row (a payout run, an admin edit, another return) bumps —
      // silently resetting/extending the return window if used.
      const deliveredAt = item.subOrder.shipment?.deliveredAt ?? item.subOrder.updatedAt;
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

      const lineQty = Math.trunc(Number(orderItem.quantity)) || 0;
      if (lineQty <= 0) {
        throw new ValidationError(ERROR_MESSAGES.RETURN_NOT_ALLOWED);
      }
      if (
        Number(orderItem.taxableAmount ?? 0) === 0 &&
        Number(orderItem.taxAmount ?? 0) === 0
      ) {
        throw new ValidationError(ERROR_MESSAGES.RETURN_NOT_ALLOWED);
      }

      const returnQuantity = data.returnQuantity ?? lineQty;
      if (returnQuantity < 1 || returnQuantity > lineQty) {
        throw new ValidationError(ERROR_MESSAGES.RETURN_QUANTITY_INVALID);
      }

      const created = await ReturnRequest.create(
        {
          subOrderId: item.subOrderId,
          orderItemId: data.orderItemId,
          userId,
          reason: data.reason,
          reasonCode: data.reasonCode,
          type: data.type,
          returnQuantity,
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

      return serializeReturn(created as ReturnRequest & { orderItem?: OrderItem }, slaDays);
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
      frozenPaise(orderItem.subOrder.shippingCostPaise) -
        frozenPaise(orderItem.subOrder.shippingDiscountAmountPaise),
    );
    const returnShippingFeePaise = await resolveReturnShippingFeePaise(orderItem.subOrder.vendorId);

    const lineQty = Math.trunc(Number(orderItem.quantity)) || 0;
    const returnQty = Math.min(
      Math.max(1, Math.floor(Number(row.returnQuantity ?? lineQty))),
      lineQty,
    );
    const isFullReturn = returnQty >= lineQty;

    const frozen = pricingService.frozenLineFromOrderItem({
      id: orderItem.id,
      quantity: Number(orderItem.quantity),
      taxBreakdown: (orderItem.taxBreakdown as any) ?? null,
      unitPricePaise: frozenPaise(orderItem.unitPricePaise),
      discountAmountPaise: frozenPaise(orderItem.discountAmountPaise),
      taxableAmountPaise: frozenPaise(orderItem.taxableAmountPaise),
      taxAmountPaise: frozenPaise(orderItem.taxAmountPaise),
      commissionAmountPaise: frozenPaise(orderItem.commissionAmountPaise),
      tcsAmountPaise: frozenPaise(orderItem.tcsAmountPaise),
      netPayoutAmountPaise: frozenPaise(orderItem.netPayoutAmountPaise),
    });

    const reversal = pricingService.reverseLineFromFrozen(frozen, returnQty, {
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
        const issuedAt = new Date();
        const { number: dnNumber } = await nextVendorDocumentNumber(
          vendorId,
          VENDOR_DOCUMENT_KIND.DEBIT_NOTE,
          issuedAt,
          t,
        );
        await DebitNote.create(
          {
            number: dnNumber,
            returnRequestId: row.id,
            orderId: orderItem.subOrder.orderId,
            orderItemId: orderItem.id,
            subOrderId: orderItem.subOrderId,
            vendorId,
            againstInvoiceNumber: orderItem.subOrder.taxInvoiceNumber ?? null,
            commissionPaise: reversal.refundCommissionPaise,
            tcsPaise: reversal.refundTcsPaise,
            netClawbackPaise: reversal.refundNetClawbackPaise,
            reason: row.reason ?? row.reasonCode ?? null,
            issuedAt,
            createdBy: actorId,
            updatedBy: actorId,
            deletedBy: null,
          },
          { transaction: t },
        );

        // GSTR-8 return adjustment (negative TCS) against original collection.
        if (reversal.refundTcsPaise > 0) {
          const vendor = await Vendor.findByPk(vendorId, {
            attributes: ['gstNumber', 'state'],
            transaction: t,
          });
          const originalTcs = await TcsLedger.findOne({
            where: {
              subOrderId: orderItem.subOrderId,
              vendorId,
              entryType: 'COLLECTION',
            },
            transaction: t,
            order: [['createdAt', 'ASC']],
          });
          const settings = await settingsService.getPlatformSettings();
          await persistTcsReturnAdjustmentLedger(
            {
              refundTcsPaise: reversal.refundTcsPaise,
              refundMerchandisePaise: reversal.refundMerchandisePaise,
              itemIgst: Number((orderItem.taxBreakdown as any)?.igst ?? 0),
              subOrderIgst: Number((orderItem.subOrder.taxBreakdown as any)?.igst ?? 0),
              orderId: orderItem.subOrder.orderId,
              subOrderId: orderItem.subOrderId,
              vendorId,
              originalTcs,
              vendor,
              fallbackRatePercent: Number(settings.tcsRatePercent ?? 0),
              returnRequestId: row.id,
              actorId,
              issuedAt,
            },
            t,
          );
        }
      }
    }

    const sub = orderItem.subOrder;
    const nextSubtotalPaise = Math.max(0, frozenPaise(sub.subtotalPaise) - reversal.refundSubtotalPaise);
    const returnedSubtotalPaise = frozenPaise(sub.subtotalPaise) - nextSubtotalPaise;
    const nextDiscountPaise = Math.max(
      0,
      frozenPaise(sub.discountAmountPaise) - reversal.refundDiscountPaise,
    );
    const nextTaxablePaise = Math.max(
      0,
      frozenPaise(sub.taxableAmountPaise) - reversal.refundMerchandisePaise,
    );
    const nextTaxPaise = Math.max(0, frozenPaise(sub.taxAmountPaise) - reversal.refundTaxPaise);
    const nextCommissionPaise = Math.max(
      0,
      frozenPaise(sub.commissionAmountPaise) - reversal.refundCommissionPaise,
    );
    const nextTcsPaise = Math.max(0, frozenPaise(sub.tcsAmountPaise) - reversal.refundTcsPaise);
    const nextNetPaise = Math.max(
      0,
      frozenPaise(sub.netPayoutAmountPaise) - reversal.refundNetClawbackPaise,
    );
    const subDisplay = recomputeSubOrderDisplayFields({
      taxableAmount: fromPaise(nextTaxablePaise),
      taxAmount: fromPaise(nextTaxPaise),
      shippingCost: sub.shippingCost,
      shippingDiscountAmount: sub.shippingDiscountAmount,
    });
    await sub.update(
      {
        shippingCharged: subDisplay.shippingCharged,
        customerTotal: subDisplay.customerTotal,
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
      isFullReturn
        ? {
            lineSubtotal: 0,
            lineTotal: 0,
            taxBreakdown: null,
            discountAmountPaise: 0,
            taxableAmountPaise: 0,
            taxAmountPaise: 0,
            commissionAmountPaise: 0,
            tcsAmountPaise: 0,
            netPayoutAmountPaise: 0,
            updatedBy: actorId,
          }
        : (() => {
            const remainingQty = lineQty - returnQty;
            const origTaxPaise = Math.max(0, frozenPaise(orderItem.taxAmountPaise));
            const nextItemDiscountPaise = Math.max(
              0,
              frozenPaise(orderItem.discountAmountPaise) - reversal.refundDiscountPaise,
            );
            const nextItemTaxablePaise = Math.max(
              0,
              frozenPaise(orderItem.taxableAmountPaise) - reversal.refundMerchandisePaise,
            );
            const nextItemTaxPaise = Math.max(
              0,
              frozenPaise(orderItem.taxAmountPaise) - reversal.refundTaxPaise,
            );
            const nextItemCommissionPaise = Math.max(
              0,
              frozenPaise(orderItem.commissionAmountPaise) - reversal.refundCommissionPaise,
            );
            const nextItemTcsPaise = Math.max(
              0,
              frozenPaise(orderItem.tcsAmountPaise) - reversal.refundTcsPaise,
            );
            const nextItemNetPaise = Math.max(
              0,
              frozenPaise(orderItem.netPayoutAmountPaise) - reversal.refundNetClawbackPaise,
            );
            const nextTaxable = fromPaise(nextItemTaxablePaise);
            const nextTax = fromPaise(nextItemTaxPaise);
            const taxRatio = origTaxPaise > 0 ? nextItemTaxPaise / origTaxPaise : 0;
            const scaledBreakdown = scaleTaxBreakdown(
              orderItem.taxBreakdown as Record<string, unknown> | null,
              taxRatio,
            );
            return {
              quantity: remainingQty,
              lineSubtotal: lineSubtotal(orderItem.unitPrice, remainingQty),
              lineTotal: lineTotal(nextTaxable, nextTax),
              taxBreakdown: scaledBreakdown,
              discountAmountPaise: nextItemDiscountPaise,
              taxableAmountPaise: nextItemTaxablePaise,
              taxAmountPaise: nextItemTaxPaise,
              commissionAmountPaise: nextItemCommissionPaise,
              tcsAmountPaise: nextItemTcsPaise,
              netPayoutAmountPaise: nextItemNetPaise,
              updatedBy: actorId,
            };
          })(),
      { transaction: t },
    );

    const allSubs = await SubOrder.findAll({
      where: { orderId: order.id },
      transaction: t,
    });
    const orderDisplay = recomputeOrderDisplayFields({
      subOrders: allSubs,
      paymentMethod: order.paymentMethod,
      totalAmount: fromPaise(nextOrderTotalPaise),
      walletAmountUsed: order.walletAmountUsed,
      razorpayAmountPaid: order.razorpayAmountPaid,
    });
    await order.update(
      {
        merchandiseSubtotal: orderDisplay.merchandiseSubtotal,
        taxTotal: orderDisplay.taxTotal,
        shippingTotal: orderDisplay.shippingTotal,
        amountDue: orderDisplay.amountDue,
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
      const salePaise = Math.max(
        0,
        frozenPaise(ledger.saleAmountPaise) - reversal.refundMerchandisePaise,
      );
      const commissionPaise = Math.max(
        0,
        frozenPaise(ledger.commissionAmountPaise) - reversal.refundCommissionPaise,
      );
      const taxablePaise = Math.max(
        0,
        frozenPaise(ledger.taxableAmountPaise) - reversal.refundMerchandisePaise,
      );
      const tcsPaise = Math.max(0, frozenPaise(ledger.tcsAmountPaise) - reversal.refundTcsPaise);
      const netPaise = Math.max(
        0,
        frozenPaise(ledger.netPayoutAmountPaise) - reversal.refundNetClawbackPaise,
      );
      const taxPaise = Math.max(0, frozenPaise(ledger.taxAmountPaise) - reversal.refundTaxPaise);
      const discountPaise = Math.max(
        0,
        frozenPaise(ledger.discountAmountPaise) - reversal.refundDiscountPaise,
      );
      await ledger.update(
        {
          saleAmountPaise: salePaise,
          commissionAmountPaise: commissionPaise,
          taxableAmountPaise: taxablePaise,
          tcsAmountPaise: tcsPaise,
          taxAmountPaise: taxPaise,
          netPayoutAmountPaise: netPaise,
          discountAmountPaise: discountPaise,
          status: netPaise <= 0 ? COMMISSION_STATUS.CLAWED_BACK : ledger.status,
          updatedBy: actorId,
        },
        { transaction: t },
      );
    }

    await shrinkPendingCashbackForReturn({
      order,
      actorId,
      transaction: t,
      merchandiseBeforePaise: toPaise(orderDisplay.merchandiseSubtotal) + returnedSubtotalPaise,
      merchandiseAfterPaise: toPaise(orderDisplay.merchandiseSubtotal),
    });
    await clawbackCashbackForReturn({
      order,
      returnRequestId: row.id,
      actorId,
      transaction: t,
      refundMerchandisePaise: reversal.refundMerchandisePaise,
      orderMerchandiseBeforePaise:
        frozenPaise(orderItem.subOrder.taxableAmountPaise) + reversal.refundMerchandisePaise,
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

    if (isCod) {
      return {
        walletRefund: customerRefund,
        razorpayRefund: 0,
        refundMethod: REFUND_METHOD.WALLET_CREDIT,
      };
    }

    // The wallet paid for all of it (wallet-only checkout, or wallet ≥ checkout total).
    if (isWalletFundedOrder(order)) {
      return {
        walletRefund: customerRefund,
        razorpayRefund: 0,
        refundMethod: REFUND_METHOD.WALLET_CREDIT,
      };
    }

    if (walletUsed <= 0) {
      return {
        walletRefund: 0,
        razorpayRefund: customerRefund,
        refundMethod: REFUND_METHOD.RAZORPAY,
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
    const walletAlready = sumRupees(prior.map((r) => r.walletRefundAmount));
    const razorpayAlready = sumRupees(prior.map((r) => r.razorpayRefundAmount));
    const walletRemaining = roundMoney(Math.max(0, walletUsed - walletAlready));
    const razorpayRemaining = roundMoney(
      Math.max(0, fromPaise(orderRazorpayPaidPaise(order)) - razorpayAlready),
    );

    // Same wallet/cash proportion sub-order cancellations use (pricing/refundSplit),
    // capped by what earlier returns on this order already gave back.
    const walletProportionPaise = walletShareOfRefundPaise(order, toPaise(customerRefund));
    let walletShare = roundMoney(Math.min(fromPaise(walletProportionPaise), walletRemaining));
    let razorpayShare = roundMoney(customerRefund - walletShare);
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
        // Both are frozen at approval together with refundAmount. A missing one means
        // the approval never completed: refuse rather than issue a credit note for ₹0.
        if (row.refundMerchandiseAmountPaise == null || row.refundTaxAmount == null) {
          throw new ValidationError(ERROR_MESSAGES.RETURN_CREDIT_NOTE_AMOUNTS_MISSING);
        }
        const merchandisePaise = frozenPaise(row.refundMerchandiseAmountPaise);
        const taxPaise = toPaise(Number(row.refundTaxAmount));
        const totalPaise = toPaise(Number(row.refundAmount));
        const issuedAt = new Date();
        const vendorId = orderItem.subOrder.vendorId;
        if (!vendorId) {
          throw new ValidationError(ERROR_MESSAGES.RETURN_CREDIT_NOTE_VENDOR_REQUIRED);
        }
        const { number: cnNumber } = await nextVendorDocumentNumber(
          vendorId,
          VENDOR_DOCUMENT_KIND.CREDIT_NOTE,
          issuedAt,
          t,
        );
        // The line's breakdown only says intra- vs inter-state; the refunded tax is
        // split in paise so CGST + SGST (or IGST) is exactly the credit note's tax.
        // (Scaling the stored breakdown mixed units: it is in rupees, the note in paise.)
        const itemTax = orderItem.taxBreakdown as { igst?: unknown } | null;
        const subOrderTax = orderItem.subOrder.taxBreakdown as { igst?: unknown } | null;
        const interState = Number(itemTax?.igst ?? 0) > 0 || Number(subOrderTax?.igst ?? 0) > 0;
        const { cgst: cgstPaise, sgst: sgstPaise, igst: igstPaise } = splitTaxAmount(
          taxPaise,
          !interState,
        );
        await CreditNote.create(
          {
            number: cnNumber,
            returnRequestId: row.id,
            orderId: order.id,
            orderItemId: orderItem.id,
            subOrderId: orderItem.subOrderId,
            vendorId,
            againstInvoiceNumber: orderItem.subOrder.taxInvoiceNumber ?? null,
            userId: row.userId,
            merchandisePaise,
            taxPaise,
            totalPaise,
            taxBreakdown: {
              refundTaxPaise: taxPaise,
              cgst: cgstPaise,
              sgst: sgstPaise,
              igst: igstPaise,
            },
            reason: row.reason ?? row.reasonCode ?? null,
            issuedAt,
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

  async transition(id: string, status: ReturnStatus, actorId: string, rejectionReason?: string) {
    const slaDays = await refundSlaDays();
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

      if (status === RETURN_STATUS.REJECTED && !rejectionReason) {
        throw new ValidationError({ rejectionReason: ['A reason is required to reject a return request'] });
      }

      const patch: Record<string, unknown> = {
        status,
        resolvedById: RESOLVED_BY_STATUSES.includes(status) ? actorId : row.resolvedById,
        resolvedAt: RESOLVED_AT_STATUSES.includes(status) ? new Date() : row.resolvedAt,
        updatedBy: actorId,
        ...(status === RETURN_STATUS.REJECTED ? { rejectionReason } : {}),
      };

      if (status === RETURN_STATUS.RECEIVED) {
        patch.receivedAt = new Date();
      }

      if (
        status === RETURN_STATUS.APPROVED &&
        row.type !== RETURN_TYPE.EXCHANGE &&
        row.refundAmount == null
      ) {
        const { reversal, order } = await this.freezeVendorAccountingOnApprove(row, actorId, t);
        const customerRefund = fromPaise(reversal.customerRefundPaise);
        const split = await this.splitRefundAmounts(order, customerRefund, t);

        // Restore order.totalAmount base for split: freeze already reduced it.
        // splitRefundAmounts reconstructs original using current + refund.

        patch.refundAmount = customerRefund;
        patch.refundTaxAmount = fromPaise(reversal.refundTaxPaise);
        patch.refundMerchandiseAmountPaise = reversal.refundMerchandisePaise;
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
            { pointSource: WALLET_POINT_SOURCE.PURCHASED, expiresAt: null },
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
        if (row.type === RETURN_TYPE.EXCHANGE) {
          throw new ValidationError(ERROR_MESSAGES.RETURN_INVALID_TRANSITION);
        }
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
      return serializeReturn(row as ReturnRequest & { orderItem?: OrderItem }, slaDays);
    });

    const pendingRazorpay = razorpayBox.refund;
    if (pendingRazorpay) {
      try {
        const refundId = await paymentsService.createRazorpayRefund(
          pendingRazorpay.paymentId,
          pendingRazorpay.amountPaise,
          { returnRequestId: pendingRazorpay.returnId },
        );
        await ReturnRequest.update(
          { razorpayRefundId: refundId, refundStatus: REFUND_STATUS.INITIATED },
          { where: { id: pendingRazorpay.returnId } },
        );
        const orderItem = await OrderItem.findByPk(result.orderItemId, {
          include: [{ model: SubOrder, as: 'subOrder', include: [{ model: Order, as: 'order' }] }],
        });
        const order = (orderItem as any)?.subOrder?.order as Order | undefined;
        if (order?.userId) {
          void notificationsService.sendRefundInitiated(order.userId, pendingRazorpay.returnId, {
            orderId: order.id,
            orderNumber: order.id.slice(0, 8).toUpperCase(),
            amount: Number(pendingRazorpay.amountPaise) / 100,
            slaDays,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Refund failed';
        const failedRow = await ReturnRequest.findByPk(pendingRazorpay.returnId);
        if (failedRow) {
          await failedRow.update({
            refundStatus: REFUND_STATUS.FAILED,
            refundAttemptCount: Number(failedRow.refundAttemptCount ?? 0) + 1,
            lastRefundAttemptAt: new Date(),
            refundFailureReason: message.slice(0, 255),
          });
        }
        throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_PENDING);
      }
    }

    if (shouldCompleteRefundImmediately || status === RETURN_STATUS.REFUNDED) {
      await this.completeRefundTrack(id, actorId);
      const refreshed = await ReturnRequest.findByPk(id, { include: returnListInclude });
      if (refreshed) {
        return serializeReturn(refreshed as ReturnRequest & { orderItem?: OrderItem }, slaDays);
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

    await logAudit({
      actorId,
      action: 'RETURN_STATUS_TRANSITIONED',
      entityType: 'ReturnRequest',
      entityId: id,
      metadata: { newStatus: status, rejectionReason, refundStatus: result.refundStatus },
    });

    return result;
  }

  /** Called from refund.processed webhook — flips refund track when Razorpay portion settles. */
  async retryRazorpayRefund(returnRequestId: string, actorId: string): Promise<void> {
    const row = await ReturnRequest.findByPk(returnRequestId);
    if (!row) throw new NotFoundError('ReturnRequest');
    if (row.refundStatus !== REFUND_STATUS.FAILED) {
      throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_RETRY_FAILED_ONLY);
    }
    const razorpayAmount = Number(row.razorpayRefundAmount ?? 0);
    if (razorpayAmount <= 0) {
      throw new ValidationError(ERROR_MESSAGES.RETURN_NO_RAZORPAY_REFUND);
    }

    const orderItem = await OrderItem.findByPk(row.orderItemId, {
      include: [{ model: SubOrder, as: 'subOrder', include: [{ model: Order, as: 'order' }] }],
    });
    const order = (orderItem as any)?.subOrder?.order as Order | undefined;
    const paymentId = order?.razorpayPaymentId;
    if (!paymentId) throw new ValidationError(ERROR_MESSAGES.RETURN_NO_RAZORPAY_PAYMENT);

    const amountPaise = toPaise(razorpayAmount);
    try {
      const refundId = await paymentsService.createRazorpayRefund(paymentId, amountPaise, {
        returnRequestId: row.id,
      });
      await row.update({
        razorpayRefundId: refundId,
        refundStatus: REFUND_STATUS.INITIATED,
        refundFailureReason: null,
        updatedBy: actorId === 'system' ? row.userId : actorId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refund failed';
      await row.update({
        refundStatus: REFUND_STATUS.FAILED,
        refundAttemptCount: Number(row.refundAttemptCount ?? 0) + 1,
        lastRefundAttemptAt: new Date(),
        refundFailureReason: message.slice(0, 255),
        updatedBy: actorId === 'system' ? row.userId : actorId,
      });
      throw new ValidationError(ERROR_MESSAGES.RETURN_REFUND_PENDING);
    }
  }

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

      const amountRupees = roundMoney(input.amountPaise / 100);
      const candidates = await ReturnRequest.findAll({
        where: {
          subOrderId: { [Op.in]: subOrderIds },
          refundStatus: { [Op.in]: [REFUND_STATUS.PENDING, REFUND_STATUS.INITIATED] },
          razorpayRefundAmount: amountRupees,
        },
        order: [['updatedAt', 'DESC']],
      });
      if (candidates.length === 1) {
        returnRow = candidates[0]!;
      } else if (candidates.length > 1) {
        const { logger } = await import('@core/logger');
        logger.warn('Ambiguous refund webhook match — manual review required', {
          paymentId: input.paymentId,
          amountPaise: input.amountPaise,
          candidateIds: candidates.map((c) => c.id),
        });
        return;
      }
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

    await logAudit({
      actorId: actorUserId,
      action: 'RETURN_REQUEST_DELETED',
      entityType: 'ReturnRequest',
      entityId: returnId,
    });
  }
}

export const returnsService = new ReturnsService();
