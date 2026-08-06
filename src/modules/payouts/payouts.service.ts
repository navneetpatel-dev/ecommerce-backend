import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Payout } from '@database/models/payout.model';
import { sequelize } from '@database/models';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { COMMISSION_STATUS, PAYOUT_STATUS } from '@core/constants/statuses';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

function serializePayout(row: Payout) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    ...plain,
    amount: Number(plain.amount),
  };
}

export class PayoutsService {
  async list(query: { page: number; limit: number }, vendorId?: string | null) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await Payout.findAndCountAll({
      where: vendorId ? { vendorId } : undefined,
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
    });
    return {
      payouts: rows.map((row) => serializePayout(row)),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async listByVendor(vendorId: string, requesterVendorId?: string | null) {
    if (requesterVendorId && requesterVendorId !== vendorId) {
      throw new ForbiddenError('Not your vendor payouts');
    }
    const rows = await Payout.findAll({
      where: { vendorId },
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) => serializePayout(row));
  }

  async process(actorId: string) {
    return sequelize.transaction(async (transaction) => {
      const ledgers = await CommissionLedger.findAll({
        where: { status: COMMISSION_STATUS.PENDING },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const grouped = new Map<string, { amount: number; start: Date; end: Date; rows: CommissionLedger[] }>();
      for (const ledger of ledgers) {
        const current = grouped.get(ledger.vendorId) ?? {
          amount: 0,
          start: ledger.createdAt,
          end: ledger.createdAt,
          rows: [],
        };
        current.amount += Number(ledger.saleAmount) - Number(ledger.commissionAmount);
        current.start = current.start < ledger.createdAt ? current.start : ledger.createdAt;
        current.end = current.end > ledger.createdAt ? current.end : ledger.createdAt;
        current.rows.push(ledger);
        grouped.set(ledger.vendorId, current);
      }
      const created: Payout[] = [];
      for (const [vendorId, group] of grouped) {
        created.push(
          await Payout.create(
            {
              vendorId,
              amount: group.amount,
              periodStart: group.start,
              periodEnd: group.end,
              status: PAYOUT_STATUS.PENDING,
              createdBy: actorId,
            },
            { transaction },
          ),
        );
        await CommissionLedger.update(
          { status: COMMISSION_STATUS.SETTLED, updatedBy: actorId },
          { where: { id: group.rows.map((row) => row.id) }, transaction },
        );
      }
      return created;
    });
  }
}

export const payoutsService = new PayoutsService();
