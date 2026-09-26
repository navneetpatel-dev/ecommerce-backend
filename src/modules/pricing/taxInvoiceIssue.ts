import type { Transaction } from 'sequelize';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { nextVendorTaxInvoiceNumber } from './vendorInvoiceSequence';
import { isReversedPart } from './partReversal';
import { recordTcsCollectionOnDispatch } from './tcsLedger';

/**
 * Issue the tax invoices for a sub-order when it is dispatched (shipped, picked up or
 * delivered), not at checkout: a sub-order cancelled before dispatch never gets an
 * invoice, so the invoice series matches the sales reported for GST. The amounts are
 * the ones frozen at checkout (`taxInvoiceSnapshot`); only the number and date are set.
 *
 * Also records the part's section 52 TCS (GSTR-8 goes by invoice month), numbers the
 * platform's invoice for the shipping on the part, and issues the order's platform
 * invoice (gift wrap) with its first dispatch.
 * Idempotent: a sub-order or order that already has its number keeps it.
 */
export async function issueTaxInvoicesOnDispatch(
  subOrderId: string,
  transaction: Transaction,
): Promise<void> {
  const subOrder = await SubOrder.findByPk(subOrderId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!subOrder || isReversedPart(subOrder.status)) return;

  if (!subOrder.taxInvoiceNumber) {
    const invoice = await nextVendorTaxInvoiceNumber(subOrder.vendorId, new Date(), transaction);
    await subOrder.update(
      { taxInvoiceNumber: invoice.number, taxInvoiceIssuedAt: invoice.issuedAt },
      { transaction },
    );
  }
  // The supply is invoiced now: its section 52 TCS belongs to this month's GSTR-8.
  await recordTcsCollectionOnDispatch(
    subOrder,
    subOrder.taxInvoiceIssuedAt ?? new Date(),
    transaction,
  );

  // The platform's invoice for the shipping it charged on this part.
  const shipping = subOrder.shippingInvoiceSnapshot;
  if (shipping && !shipping.invoiceNumber) {
    const invoice = await nextVendorTaxInvoiceNumber(null, new Date(), transaction);
    await subOrder.update(
      {
        shippingInvoiceSnapshot: {
          ...shipping,
          invoiceNumber: invoice.number,
          issuedAt: invoice.issuedAt.toISOString(),
        },
      },
      { transaction },
    );
  }

  const order = await Order.findByPk(subOrder.orderId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const snapshot = order?.platformInvoiceSnapshot;
  if (order && snapshot && !snapshot.invoiceNumber) {
    const invoice = await nextVendorTaxInvoiceNumber(null, new Date(), transaction);
    await order.update(
      {
        platformInvoiceSnapshot: {
          ...snapshot,
          invoiceNumber: invoice.number,
          issuedAt: invoice.issuedAt.toISOString(),
        },
      },
      { transaction },
    );
  }
}
