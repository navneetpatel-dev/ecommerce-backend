/**
 * Returns and exchanges: at least RETURNS_PER_CUSTOMER per customer (so every vendor gets
 * hundreds), in every status, with refunds computed from the priced lines. Every refunded
 * return gets what the refund path writes: the customer's credit note and the vendor's
 * debit note (numbered by the app's own series), the GSTR-8 TCS reversal, and the
 * commission clawback the vendor's next payout recovers.
 */
import { sequelize } from '../../database/models';
import { nextVendorDocumentNumber, VENDOR_DOCUMENT_KIND } from '../../src/modules/pricing/vendorInvoiceSequence';
import { splitTaxAmount } from '../../src/modules/pricing/pricing.engine';
import { recordTcsReturnAdjustmentForCreditNote } from '../../src/modules/returns/returns.service';
import { NOW, addDays, chance, id, insert, int, json, minDate, pick, select, weighted, photo } from './lib';
import { scaled } from './scale';
import type { Accounts } from './accounts';

export const RETURNS_PER_CUSTOMER = scaled(105, 4);

type Line = {
  itemId: string; partId: string; orderId: string; userId: string; vendorId: string; partStatus: string;
  quantity: number; taxable: number; tax: number; commission: number; tcs: number; net: number;
  supplyTaxable: number; supplyTax: number; discount: number; igst: string | null;
  deliveredAt: Date; method: string; invoice: string | null; returnFee: string | null;
};

const REASONS = {
  DAMAGED: 'The product arrived damaged; the box was crushed.',
  WRONG_ITEM: 'I received a different colour from the one I ordered.',
  NOT_AS_DESCRIBED: 'The material is not what the listing describes.',
  NO_LONGER_NEEDED: 'Bought it as a gift, no longer needed.',
  OTHER: 'Size runs small; would like to return it.',
} as const;

/** A return's status for one requested this long ago: old ones are settled, recent ones open. */
function returnStatus(fullReturn: boolean, ageDays: number): string {
  if (fullReturn) return pick(['REFUNDED', 'REFUNDED', 'CLOSED']);
  if (ageDays > 20) return weighted([['REJECTED', 15], ['REFUNDED', 65], ['CLOSED', 20]] as const);
  return weighted([['REQUESTED', 25], ['APPROVED', 20], ['PICKUP_SCHEDULED', 20], ['RECEIVED', 15], ['REJECTED', 5], ['REFUNDED', 15]] as const);
}

export async function seedAfterSales(accounts: Accounts): Promise<void> {
  const lines = await select<Line>(`
    SELECT i.id AS "itemId", s.id AS "partId", o.id AS "orderId", o."userId", s."vendorId", s.status::text AS "partStatus",
      i.quantity, i."taxableAmountPaise"::bigint::int AS taxable, i."taxAmountPaise"::bigint::int AS tax,
      i."commissionAmountPaise"::bigint::int AS commission, COALESCE(i."tcsAmountPaise", 0)::bigint::int AS tcs,
      i."netPayoutAmountPaise"::bigint::int AS net, COALESCE(i."supplyTaxablePaise", i."taxableAmountPaise")::bigint::int AS "supplyTaxable",
      COALESCE(i."supplyTaxPaise", i."taxAmountPaise")::bigint::int AS "supplyTax", COALESCE(i."discountAmountPaise", 0)::bigint::int AS discount,
      (i."taxBreakdown"->>'igst') AS igst, COALESCE(sh."deliveredAt", s."updatedAt") AS "deliveredAt",
      o."paymentMethod"::text AS method, s."taxInvoiceNumber" AS invoice, v."returnShippingFee"::text AS "returnFee"
    FROM order_items i JOIN sub_orders s ON s.id = i."subOrderId" JOIN orders o ON o.id = s."orderId"
    JOIN vendors v ON v.id = s."vendorId" LEFT JOIN shipments sh ON sh."subOrderId" = s.id
    WHERE s.status IN ('DELIVERED', 'RETURNED') AND i."taxableAmountPaise" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM return_requests r WHERE r."orderItemId" = i.id)
    ORDER BY o."userId", COALESCE(sh."deliveredAt", s."updatedAt")`);
  const byUser = new Map<string, Line[]>();
  for (const line of lines) byUser.set(line.userId, [...(byUser.get(line.userId) ?? []), line]);

  const returns: Array<Record<string, unknown>> = [];
  const refunded: Array<{ row: Record<string, unknown>; line: Line; share: number }> = [];
  for (const customer of accounts.customers) {
    const own = byUser.get(customer.id) ?? [];
    // Wholly returned parts first (every line of them), then other delivered lines.
    const chosen = [...own.filter((l) => l.partStatus === 'RETURNED'), ...own.filter((l) => l.partStatus !== 'RETURNED' && chance(0.6))];
    for (const line of chosen.slice(0, Math.max(RETURNS_PER_CUSTOMER, own.filter((l) => l.partStatus === 'RETURNED').length))) {
      const full = line.partStatus === 'RETURNED';
      const requestedAt = minDate(addDays(line.deliveredAt, int(1, 6)), NOW);
      const status = returnStatus(full, (NOW.getTime() - requestedAt.getTime()) / 86_400_000);
      const reasonCode = pick(Object.keys(REASONS)) as keyof typeof REASONS;
      const returnQuantity = full ? line.quantity : int(1, line.quantity);
      const share = returnQuantity / line.quantity;
      const receivedAt = ['RECEIVED', 'REFUNDED', 'CLOSED'].includes(status) ? minDate(addDays(requestedAt, int(3, 6)), NOW) : null;
      const resolvedAt = ['REJECTED', 'REFUNDED', 'CLOSED'].includes(status) ? minDate(addDays(receivedAt ?? requestedAt, 1), NOW) : null;
      const isRefund = status === 'REFUNDED' || (status === 'CLOSED' && chance(0.6));
      const exchange = !isRefund && !full && chance(0.25);
      const merchandise = Math.round(line.taxable * share);
      const tax = Math.round(line.tax * share);
      const fee = reasonCode === 'NO_LONGER_NEEDED' ? Number(line.returnFee ?? 0) : 0;
      const refundAmount = Math.max(0, (merchandise + tax) / 100 - fee);
      const toWallet = line.method === 'COD' || chance(0.3);
      const row = {
        id: id(), subOrderId: line.partId, orderItemId: line.itemId, userId: line.userId,
        reason: REASONS[reasonCode], reasonCode, status, type: exchange ? 'EXCHANGE' : 'REFUND', returnQuantity,
        refundAmount, refundTaxAmount: tax / 100, refundCommissionAmount: Math.round(line.commission * share) / 100,
        refundTcsAmount: Math.round(line.tcs * share) / 100, refundNetClawback: Math.round(line.net * share) / 100,
        refundMerchandiseAmountPaise: merchandise, refundSupplyTaxablePaise: Math.round(line.supplyTaxable * share),
        refundSupplyTaxPaise: Math.round(line.supplyTax * share), returnShippingFeeAmount: fee, shippingRefundAmount: 0,
        refundMethod: exchange ? null : toWallet ? 'WALLET_CREDIT' : 'RAZORPAY',
        refundStatus: isRefund ? 'COMPLETED' : status === 'RECEIVED' ? pick(['PENDING', 'INITIATED', 'FAILED']) : 'NONE',
        refundFailureReason: null as string | null, refundAttemptCount: isRefund ? 1 : 0,
        walletRefundAmount: isRefund && toWallet ? refundAmount : 0, razorpayRefundAmount: isRefund && !toWallet ? refundAmount : 0,
        razorpayRefundId: isRefund && !toWallet ? `rfnd_${line.itemId.replace(/-/g, '').slice(0, 14)}` : null,
        photoUrls: json(reasonCode === 'DAMAGED' || reasonCode === 'WRONG_ITEM' ? [1, 2].map((n) => photo(`ret-${line.itemId.slice(0, 6)}-${n}`)) : []),
        receivedAt, resolvedAt, resolvedById: resolvedAt ? pick(accounts.adminIds) : null,
        rejectionReason: status === 'REJECTED' ? 'The item shows signs of use, so it is not eligible for return.' : null,
        restockedAt: receivedAt && chance(0.7) ? receivedAt : null, restockedBy: null as string | null,
        replacementDeliveredAt: exchange && status === 'CLOSED' ? resolvedAt : null,
        createdAt: requestedAt, updatedAt: resolvedAt ?? receivedAt ?? requestedAt,
      };
      if (row.refundStatus === 'FAILED') {
        row.refundFailureReason = 'Bank rejected the refund: account closed';
        row.refundAttemptCount = 2;
      }
      returns.push(row);
      if (isRefund) refunded.push({ row, line, share });
    }
  }
  await insert('return_requests', returns);
  console.log(`  ${returns.length} returns (${refunded.length} refunded)`);

  // The refund path's documents, numbered by the vendor's own series, in batches.
  const clawbacks: Array<Record<string, unknown>> = [];
  for (let start = 0; start < refunded.length; start += 200) {
    await sequelize.transaction(async (t) => {
      for (const { row, line, share } of refunded.slice(start, start + 200)) {
        const issuedAt = row.resolvedAt as Date;
        const merchandise = row.refundMerchandiseAmountPaise as number;
        const taxPaise = Math.round(line.tax * share);
        const debit = await nextVendorDocumentNumber(line.vendorId, VENDOR_DOCUMENT_KIND.DEBIT_NOTE, issuedAt, t);
        await sequelize.getQueryInterface().bulkInsert('debit_notes', [{
          id: id(), number: debit.number, returnRequestId: row.id, orderId: line.orderId, orderItemId: line.itemId,
          subOrderId: line.partId, vendorId: line.vendorId, againstInvoiceNumber: line.invoice,
          commissionPaise: Math.round(line.commission * share), tcsPaise: Math.round(line.tcs * share),
          netClawbackPaise: Math.round(line.net * share), reason: row.reason, issuedAt, createdAt: issuedAt, updatedAt: issuedAt,
        }], { transaction: t });
        const credit = await nextVendorDocumentNumber(line.vendorId, VENDOR_DOCUMENT_KIND.CREDIT_NOTE, issuedAt, t);
        const split = splitTaxAmount(taxPaise, !(Number(line.igst ?? 0) > 0));
        await sequelize.getQueryInterface().bulkInsert('credit_notes', [{
          id: id(), number: credit.number, returnRequestId: row.id, orderId: line.orderId, orderItemId: line.itemId,
          subOrderId: line.partId, vendorId: line.vendorId, againstInvoiceNumber: line.invoice, userId: line.userId,
          merchandisePaise: merchandise, taxPaise, totalPaise: merchandise + taxPaise,
          taxBreakdown: json({ refundTaxPaise: taxPaise, cgst: split.cgst, sgst: split.sgst, igst: split.igst }),
          reason: row.reason, issuedAt, createdAt: issuedAt, updatedAt: issuedAt,
        }], { transaction: t });
        await recordTcsReturnAdjustmentForCreditNote(
          { returnRequestId: row.id as string, orderId: line.orderId, subOrderId: line.partId, vendorId: line.vendorId, refundMerchandisePaise: merchandise, actorId: null, issuedAt },
          t,
        );
        if (line.partStatus !== 'RETURNED') {
          clawbacks.push({
            id: id(), vendorId: line.vendorId, subOrderId: line.partId, commissionRate: line.taxable > 0 ? Math.round((line.commission / line.taxable) * 10_000) / 100 : 0,
            discountBearer: 'PLATFORM', saleAmountPaise: -Math.round(line.supplyTaxable * share), commissionAmountPaise: -Math.round(line.commission * share),
            taxableAmountPaise: -merchandise, supplyTaxablePaise: -Math.round(line.supplyTaxable * share), discountAmountPaise: -Math.round(line.discount * share),
            taxAmountPaise: -taxPaise, tcsAmountPaise: -Math.round(line.tcs * share), netPayoutAmountPaise: -Math.round(line.net * share),
            shippingCollectedPaise: 0, referenceType: 'RETURN_CLAWBACK', status: 'PENDING', createdAt: issuedAt, updatedAt: issuedAt,
          });
        }
      }
    });
  }
  await insert('commission_ledgers', clawbacks);
}
