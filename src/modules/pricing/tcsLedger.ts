import type { Transaction } from 'sequelize';
import { Address } from '@database/models/address.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Order } from '@database/models/order.model';
import { OrderItem } from '@database/models/orderItem.model';
import type { SubOrder } from '@database/models/subOrder.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { Vendor } from '@database/models/vendor.model';
import { COMMISSION_STATUS } from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';
import { frozenPaise } from './frozenMoneySql';
import { gstPeriodOf } from './gstPeriod';
import { allocateProportionally } from './money';
import { gstOnTaxablePaise, splitTaxAmount } from './pricing.engine';
import { isIntraStateSupply } from './gstPlaceOfSupply';

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
    /**
     * The supply is inter-state: the vendor's state differs from the place of supply.
     * Section 52 TCS follows the supply, not whether GST happened to be charged (a
     * nil-rated line has no IGST to go by). When omitted, read from `taxIgst`.
     */
    interState?: boolean;
  },
  transaction: Transaction,
) {
  const useIgst = params.interState ?? Number(params.taxIgst ?? 0) > 0;
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
  if (!subOrder.vendorId) return;
  // No TCS and no rate to take it at now (checked out before the rate was kept).
  if (frozenPaise(subOrder.tcsAmountPaise) <= 0 && subOrder.tcsRatePercent == null) return;
  const existing = await TcsLedger.findOne({
    where: { subOrderId: subOrder.id, entryType: 'COLLECTION' },
    transaction,
  });
  if (existing) return;
  await reRateTcsOnDispatch(subOrder, transaction);
  const tcsPaise = frozenPaise(subOrder.tcsAmountPaise);
  if (tcsPaise <= 0) return;

  // TCS is collected on taxable (not nil-rated) supplies: the invoice lines charged GST.
  const snapshotLines = subOrder.taxInvoiceSnapshot?.lines ?? null;
  const taxablePaise = snapshotLines
    ? snapshotLines.reduce(
        (sum, line) =>
          sum +
          (line.gstPercentage === 0 || line.cgstPaise + line.sgstPaise + line.igstPaise === 0
            ? 0
            : line.taxablePaise),
        0,
      )
    : frozenPaise(subOrder.taxableAmountPaise);
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
  const placeOfSupplyState = order?.shippingAddress?.state ?? vendor?.state ?? null;
  await persistTcsCollectionLedger(
    {
      tcsTotal: tcsPaise,
      taxIgst,
      interState: !isIntraStateSupply(vendor?.state ?? null, placeOfSupplyState),
      orderId: subOrder.orderId,
      subOrderId: subOrder.id,
      vendorId: subOrder.vendorId,
      taxableAmountPaise: taxablePaise,
      ratePercent,
      vendorGstin: vendor?.gstNumber ?? null,
      placeOfSupplyState,
      actorId: null,
      issuedAt,
    },
    transaction,
  );
}

/** An order item's section 52 TCS base: its value of supply, none on a nil-rated line. */
function itemTcsBasePaise(item: OrderItem): number {
  const gstPercentage = (item.taxBreakdown as { gstPercentage?: unknown } | null)?.gstPercentage;
  const nilRated =
    gstPercentage != null ? Number(gstPercentage) === 0 : frozenPaise(item.taxAmountPaise) === 0;
  if (nilRated) return 0;
  return item.supplyTaxablePaise != null
    ? Number(item.supplyTaxablePaise)
    : frozenPaise(item.taxableAmountPaise);
}

/**
 * TCS is collected when the supply is made (the invoice at dispatch), at the rate in
 * force then. When the platform's rate changed since checkout, work the part's TCS out
 * again at the current rate — on its items, the part and its (unpaid) sale ledger — and
 * move the difference into the vendor's net. A part checked out before the rate was kept
 * (no `tcsRatePercent`), or whose sale was already paid out, keeps its figures.
 */
async function reRateTcsOnDispatch(subOrder: SubOrder, transaction: Transaction): Promise<void> {
  if (subOrder.tcsRatePercent == null) return;
  const settings = await settingsService.getPlatformSettings();
  const ratePercent = Number(settings.tcsRatePercent ?? 0);
  if (!Number.isFinite(ratePercent) || ratePercent === Number(subOrder.tcsRatePercent)) return;

  const ledger = await CommissionLedger.findOne({
    where: { subOrderId: subOrder.id, referenceType: null },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (ledger && ledger.status !== COMMISSION_STATUS.PENDING) return;

  const [items, vendor, order] = await Promise.all([
    OrderItem.findAll({ where: { subOrderId: subOrder.id }, transaction, lock: transaction.LOCK.UPDATE }),
    Vendor.findByPk(subOrder.vendorId!, { attributes: ['state'], transaction }),
    Order.findByPk(subOrder.orderId, {
      attributes: ['id', 'shippingAddressId'],
      include: [{ model: Address, as: 'shippingAddress', attributes: ['state'] }],
      transaction,
    }) as Promise<(Order & { shippingAddress?: Address | null }) | null>,
  ]);
  const placeOfSupplyState = order?.shippingAddress?.state ?? vendor?.state ?? null;
  const intraState = isIntraStateSupply(vendor?.state ?? null, placeOfSupplyState);
  const bases = items.map(itemTcsBasePaise);
  // As the pricing engine does: on the part's total, then shared across its lines.
  const tcsPaise = gstOnTaxablePaise(
    bases.reduce((sum, base) => sum + base, 0),
    ratePercent,
    intraState,
  ).total;
  const lineTcs = allocateProportionally(tcsPaise, bases);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const before = frozenPaise(item.tcsAmountPaise);
    const after = lineTcs[i] ?? 0;
    if (before === after) continue;
    await item.update(
      {
        tcsAmountPaise: after,
        netPayoutAmountPaise: frozenPaise(item.netPayoutAmountPaise) + before - after,
      },
      { transaction },
    );
  }
  const deltaPaise = frozenPaise(subOrder.tcsAmountPaise) - tcsPaise;
  await subOrder.update(
    {
      tcsAmountPaise: tcsPaise,
      tcsRatePercent: ratePercent,
      netPayoutAmountPaise: frozenPaise(subOrder.netPayoutAmountPaise) + deltaPaise,
    },
    { transaction },
  );
  if (ledger) {
    await ledger.update(
      {
        tcsAmountPaise: frozenPaise(ledger.tcsAmountPaise) - deltaPaise,
        netPayoutAmountPaise: frozenPaise(ledger.netPayoutAmountPaise) + deltaPaise,
      },
      { transaction },
    );
  }
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
