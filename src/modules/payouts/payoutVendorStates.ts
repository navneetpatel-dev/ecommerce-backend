import { Op } from 'sequelize';
import { Vendor } from '@database/models/vendor.model';
import { normalizePayoutCycle, payoutDeliveryCutoff } from './payoutCycle';

/**
 * One lookup for every vendor in a payout run (was `Vendor.findByPk` per vendor —
 * N+1). Returns id → state so GST split selection stays a single query.
 */
export async function vendorStatesFor(vendorIds: string[]): Promise<Map<string, string | null>> {
  if (vendorIds.length === 0) return new Map();
  const rows = await Vendor.findAll({
    where: { id: { [Op.in]: vendorIds } },
    attributes: ['id', 'state'],
  });
  return new Map(rows.map((row) => [row.id, row.state]));
}

/** id → the vendor's preferred payout frequency (null when they have not chosen one). */
export async function vendorPayoutFrequencies(vendorIds: string[]): Promise<Map<string, string | null>> {
  if (vendorIds.length === 0) return new Map();
  const rows = await Vendor.findAll({
    where: { id: { [Op.in]: vendorIds } },
    attributes: ['id', 'payoutFrequency'],
  });
  return new Map(rows.map((row) => [row.id, row.payoutFrequency ?? null]));
}

/**
 * The ledgers whose sale was delivered before the payout-cycle boundary of their vendor (the
 * platform cycle, or the vendor's own longer preference). Later deliveries wait for the next
 * run. A ledger with no delivery time passes: the candidate query already requires one.
 */
export async function ledgersDeliveredBeforeCycle<
  T extends { vendorId: string; SubOrder?: { shipment?: { deliveredAt?: Date | null } } | null },
>(ledgers: T[], platformCycleSetting: unknown, now: Date = new Date()): Promise<T[]> {
  const platformCycle = normalizePayoutCycle(platformCycleSetting);
  const preferences = await vendorPayoutFrequencies([...new Set(ledgers.map((ledger) => ledger.vendorId))]);
  return ledgers.filter((ledger) => {
    const deliveredAt = ledger.SubOrder?.shipment?.deliveredAt;
    if (!deliveredAt) return true;
    return new Date(deliveredAt) < payoutDeliveryCutoff(platformCycle, preferences.get(ledger.vendorId), now);
  });
}
