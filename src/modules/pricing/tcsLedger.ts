import type { Transaction } from 'sequelize';
import { Address } from '@database/models/address.model';
import { Order } from '@database/models/order.model';
import type { SubOrder } from '@database/models/subOrder.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { Vendor } from '@database/models/vendor.model';
import { frozenPaise } from './frozenMoneySql';
import { gstPeriodOf } from './gstPeriod';
import { splitTaxAmount } from './pricing.engine';

/**
 * Record a section 52 TCS collection (GSTR-8). `issuedAt` is when the supply was
 * invoiced — the part's dispatch — and decides the period, in IST.
 */
export async function persistTcsCollectionLedger(
  params: {
    tcsTotal: number;
    taxIgst: number;
    orderId: string;
    subOrderId: string;
    vendorId: string;
    taxableAmountPaise: number;
    ratePercent: number;
    vendorGstin: string | null;
    placeOfSupplyState: string | null;
    actorId: string | null;
    issuedAt?: Date;
  },
  transaction: Transaction,
) {
  const useIgst = Number(params.taxIgst ?? 0) > 0;
  const { cgst: tcsCgstPaise, sgst: tcsSgstPaise, igst: tcsIgstPaise } = splitTaxAmount(
    params.tcsTotal,
    !useIgst,
  );
  return TcsLedger.create(
    {
      orderId: params.orderId,
      subOrderId: params.subOrderId,
      vendorId: params.vendorId,
      taxableAmountPaise: params.taxableAmountPaise,
      ratePercent: params.ratePercent,
      tcsAmountPaise: params.tcsTotal,
      tcsCgstPaise,
      tcsSgstPaise,
      tcsIgstPaise,
      period: gstPeriodOf(params.issuedAt ?? new Date()),
      section: '52',
      entryType: 'COLLECTION',
      vendorGstin: params.vendorGstin,
      placeOfSupplyState: params.placeOfSupplyState,
      returnRequestId: null,
      createdBy: params.actorId,
      updatedBy: params.actorId,
      deletedBy: null,
    },
    { transaction },
  );
}

/**
 * Record the TCS on a part when its tax invoice is issued at dispatch — the supply the
 * TCS is collected on — at the rate frozen at checkout. Not at checkout: a part
 * cancelled before dispatch was never supplied, and the GSTR-8 period is the month of
 * the invoice. Idempotent; a part checked out before this change already has its row.
 */
export async function recordTcsCollectionOnDispatch(
  subOrder: SubOrder,
  issuedAt: Date,
  transaction: Transaction,
): Promise<void> {
  const tcsPaise = frozenPaise(subOrder.tcsAmountPaise);
  if (tcsPaise <= 0 || !subOrder.vendorId) return;
  const existing = await TcsLedger.findOne({
    where: { subOrderId: subOrder.id, entryType: 'COLLECTION' },
    transaction,
  });
  if (existing) return;

  const taxablePaise = frozenPaise(subOrder.taxableAmountPaise);
  const [vendor, order] = await Promise.all([
    Vendor.findByPk(subOrder.vendorId, { attributes: ['gstNumber', 'state'], transaction }),
    Order.findByPk(subOrder.orderId, {
      attributes: ['id', 'shippingAddressId'],
      include: [{ model: Address, as: 'shippingAddress', attributes: ['state'] }],
      transaction,
    }) as Promise<(Order & { shippingAddress?: Address | null }) | null>,
  ]);
  const ratePercent =
    subOrder.tcsRatePercent != null
      ? Number(subOrder.tcsRatePercent)
      : taxablePaise > 0
        ? Math.round((tcsPaise / taxablePaise) * 100_000) / 1000
        : 0;
  const taxIgst = Number((subOrder.taxBreakdown as { igst?: unknown } | null)?.igst ?? 0);
  await persistTcsCollectionLedger(
    {
      tcsTotal: tcsPaise,
      taxIgst,
      orderId: subOrder.orderId,
      subOrderId: subOrder.id,
      vendorId: subOrder.vendorId,
      taxableAmountPaise: taxablePaise,
      ratePercent,
      vendorGstin: vendor?.gstNumber ?? null,
      placeOfSupplyState: order?.shippingAddress?.state ?? vendor?.state ?? null,
      actorId: null,
      issuedAt,
    },
    transaction,
  );
}

/**
 * A dispatched part came back undelivered (RTO): the supply was reversed, so reverse
 * its TCS with a negative adjustment in the current period. The collection stays in
 * the period it was reported in (it may already be filed) — it is not deleted.
 */
export async function reverseTcsForReturnedPart(
  subOrder: SubOrder,
  transaction: Transaction,
): Promise<void> {
  const rows = await TcsLedger.findAll({ where: { subOrderId: subOrder.id }, transaction });
  const collection = rows.find((row) => row.entryType === 'COLLECTION');
  if (!collection) return;
  const sum = (pick: (row: TcsLedger) => unknown) =>
    rows.reduce((total, row) => total + Number(pick(row) ?? 0), 0);
  const tcsPaise = sum((row) => row.tcsAmountPaise);
  if (tcsPaise === 0) return;
  await TcsLedger.create(
    {
      orderId: collection.orderId,
      subOrderId: subOrder.id,
      vendorId: collection.vendorId,
      taxableAmountPaise: -sum((row) => row.taxableAmountPaise),
      ratePercent: Number(collection.ratePercent),
      tcsAmountPaise: -tcsPaise,
      tcsCgstPaise: -sum((row) => row.tcsCgstPaise),
      tcsSgstPaise: -sum((row) => row.tcsSgstPaise),
      tcsIgstPaise: -sum((row) => row.tcsIgstPaise),
      period: gstPeriodOf(new Date()),
      section: '52',
      entryType: 'RETURN_ADJUSTMENT',
      vendorGstin: collection.vendorGstin,
      placeOfSupplyState: collection.placeOfSupplyState,
      returnRequestId: null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    },
    { transaction },
  );
}
