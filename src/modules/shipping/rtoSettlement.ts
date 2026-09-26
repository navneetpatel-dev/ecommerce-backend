import type { Transaction } from 'sequelize';
import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  REFUND_STATUS,
} from '@core/constants/statuses';
import { CreditNote } from '@database/models/creditNote.model';
import { Order } from '@database/models/order.model';
import type { OrderItem } from '@database/models/orderItem.model';
import type { SubOrder } from '@database/models/subOrder.model';
import { fromPaise, toPaise } from '@modules/pricing/money';
import { frozenPaise } from '@modules/pricing/frozenMoneySql';
import { isReversedPart, reversedPartCashSharePaise } from '@modules/pricing/partReversal';
import { walletShareOfRefundPaise } from '@modules/pricing/refundSplit';
import { splitTaxAmount } from '@modules/pricing/pricing.engine';
import { nextVendorDocumentNumber, VENDOR_DOCUMENT_KIND } from '@modules/pricing/vendorInvoiceSequence';
import {
  returnWalletShareForCancelledPart,
  rollbackOrderWalletIfNeeded,
} from '@modules/wallet/walletOrderRollback';
import { notificationsService } from '@modules/notifications/notifications.service';
import { issuePartCardRefund, markPartCardRefundPending } from '@modules/payments/partCardRefund';

export const RTO_CREDIT_NOTE_REASON = 'Returned undelivered (RTO)';

const totalPaise = (sub: SubOrder) => toPaise(Number(sub.customerTotal ?? 0));

/**
 * Refund a part that came back undelivered (RTO) the way a cancellation is refunded:
 * - its wallet share goes back as the checkout spend it was (promotional / purchased
 *   mix), for COD orders too — the wallet was spent at checkout either way;
 * - its cash share goes back to the card (Razorpay), after the transaction commits;
 * - the last part of the order to be reversed returns whatever is left: the rest of
 *   the wallet spend and of the Razorpay payment, gift-wrap fee included.
 * It used to credit the whole part to the wallet as promotional points, card money too,
 * and refund nothing on a COD order.
 */
export async function refundReturnedUndeliveredPart(
  subOrder: SubOrder,
  order: Order,
  siblings: SubOrder[],
  transaction: Transaction,
): Promise<void> {
  const partPaise = totalPaise(subOrder);
  const others = siblings.filter((sub) => sub.id !== subOrder.id && isReversedPart(sub.status));
  const lastPart = siblings.every((sub) => sub.id === subOrder.id || isReversedPart(sub.status));

  const walletUsedPaise = toPaise(Number(order.walletAmountUsed ?? 0));
  const walletBackPaise = lastPart
    ? Math.max(
        0,
        walletUsedPaise -
          others.reduce((sum, sub) => sum + walletShareOfRefundPaise(order, totalPaise(sub)), 0),
      )
    : walletShareOfRefundPaise(order, partPaise);
  if (lastPart) {
    await rollbackOrderWalletIfNeeded(order, order.userId, transaction);
  } else {
    await returnWalletShareForCancelledPart(
      order,
      subOrder.id,
      walletShareOfRefundPaise(order, partPaise),
      order.userId,
      transaction,
    );
  }

  const paymentId = order.razorpayPaymentId;
  const cashPaise =
    order.paymentMethod !== PAYMENT_METHOD.COD &&
    order.paymentStatus === PAYMENT_STATUS.PAID &&
    paymentId
      ? reversedPartCashSharePaise(order, partPaise, others.map(totalPaise), lastPart)
      : 0;

  if (cashPaise > 0 && paymentId) {
    await markPartCardRefundPending(subOrder.id, cashPaise, transaction);
    if (lastPart) {
      await order.update({ cancelRefundStatus: REFUND_STATUS.PENDING }, { transaction });
    }
    transaction.afterCommit(async () => {
      await issuePartCardRefund({
        orderId: order.id,
        subOrderId: subOrder.id,
        paymentId,
        amountPaise: cashPaise,
        lastPart,
      });
    });
  }

  const refundedPaise = cashPaise + walletBackPaise;
  if (refundedPaise > 0) {
    void notificationsService.sendRefundProcessed(order.userId, subOrder.id, {
      amount: fromPaise(refundedPaise),
      orderNumber: order.id.slice(0, 8).toUpperCase(),
    });
  }
}

type CreditNoteLine = {
  orderItemId: string | null;
  merchandisePaise: number;
  cgst: number;
  sgst: number;
  igst: number;
};

async function createCreditNote(
  input: {
    vendorId: string | null;
    order: Order;
    subOrderId: string | null;
    againstInvoiceNumber: string;
    line: CreditNoteLine;
  },
  transaction: Transaction,
): Promise<void> {
  const issuedAt = new Date();
  const { number } = await nextVendorDocumentNumber(
    input.vendorId,
    VENDOR_DOCUMENT_KIND.CREDIT_NOTE,
    issuedAt,
    transaction,
  );
  const taxPaise = input.line.cgst + input.line.sgst + input.line.igst;
  await CreditNote.create(
    {
      number,
      returnRequestId: null,
      orderId: input.order.id,
      orderItemId: input.line.orderItemId,
      subOrderId: input.subOrderId,
      vendorId: input.vendorId,
      againstInvoiceNumber: input.againstInvoiceNumber,
      userId: input.order.userId,
      merchandisePaise: input.line.merchandisePaise,
      taxPaise,
      totalPaise: input.line.merchandisePaise + taxPaise,
      taxBreakdown: {
        refundTaxPaise: taxPaise,
        cgst: input.line.cgst,
        sgst: input.line.sgst,
        igst: input.line.igst,
      },
      reason: RTO_CREDIT_NOTE_REASON,
      issuedAt,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    },
    { transaction },
  );
}

/**
 * Credit notes reversing the tax invoice of a part that came back undelivered: one per
 * invoice line, from the amounts issued (`taxInvoiceSnapshot`, else the order lines).
 * When this was the last part of the order, the gift-wrap platform invoice is credited
 * too. Nothing is issued for an invoice that was never numbered.
 */
export async function issueRtoCreditNotes(
  subOrder: SubOrder & { items?: OrderItem[] },
  order: Order,
  siblings: SubOrder[],
  transaction: Transaction,
): Promise<void> {
  if (subOrder.taxInvoiceNumber) {
    const snapshot = subOrder.taxInvoiceSnapshot;
    const lines: CreditNoteLine[] = snapshot
      ? snapshot.lines.map((line) => ({
          orderItemId: line.orderItemId,
          merchandisePaise: line.taxablePaise,
          cgst: line.cgstPaise,
          sgst: line.sgstPaise,
          igst: line.igstPaise,
        }))
      : (subOrder.items ?? []).map((item) => {
          const interState = Number((item.taxBreakdown as { igst?: unknown } | null)?.igst ?? 0) > 0;
          const split = splitTaxAmount(frozenPaise(item.taxAmountPaise), !interState);
          return {
            orderItemId: item.id,
            merchandisePaise: frozenPaise(item.taxableAmountPaise),
            cgst: split.cgst,
            sgst: split.sgst,
            igst: split.igst,
          };
        });
    for (const line of lines) {
      await createCreditNote(
        {
          vendorId: subOrder.vendorId,
          order,
          subOrderId: subOrder.id,
          againstInvoiceNumber: subOrder.taxInvoiceNumber,
          line,
        },
        transaction,
      );
    }
  }

  // The platform's invoice for the shipping on this part: the delivery was not made.
  const shipping = subOrder.shippingInvoiceSnapshot;
  if (shipping?.invoiceNumber) {
    for (const line of shipping.lines) {
      await createCreditNote(
        {
          vendorId: null,
          order,
          subOrderId: subOrder.id,
          againstInvoiceNumber: shipping.invoiceNumber,
          line: {
            orderItemId: null,
            merchandisePaise: line.taxablePaise,
            cgst: line.cgstPaise,
            sgst: line.sgstPaise,
            igst: line.igstPaise,
          },
        },
        transaction,
      );
    }
  }

  const lastPart = siblings.every((sub) => sub.id === subOrder.id || isReversedPart(sub.status));
  const platform = order.platformInvoiceSnapshot;
  if (lastPart && platform?.invoiceNumber) {
    for (const line of platform.lines) {
      await createCreditNote(
        {
          vendorId: null,
          order,
          subOrderId: null,
          againstInvoiceNumber: platform.invoiceNumber,
          line: {
            orderItemId: null,
            merchandisePaise: line.taxablePaise,
            cgst: line.cgstPaise,
            sgst: line.sgstPaise,
            igst: line.igstPaise,
          },
        },
        transaction,
      );
    }
  }
}
