import { Op } from 'sequelize';
import { Vendor } from '@database/models/vendor.model';

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
