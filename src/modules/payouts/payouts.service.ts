import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Payout } from '@database/models/payout.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { COMMISSION_STATUS, PAYOUT_STATUS } from '@core/constants/statuses';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { notificationsService } from '@modules/notifications/notifications.service';
import { findVendorOwnerUserId } from '@modules/notifications/orderNotifications';
import { logger } from '@core/logger';
import { Op } from 'sequelize';

function serializePayout(row: Payout) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  const { Vendor: vendorAssoc, ...rest } = plain;
  return {
    ...rest,
    amount: Number(plain.amount),
    vendorName: vendorAssoc?.businessName ?? null,
  };
}

const vendorInclude = {
  model: Vendor,
  attributes: ['id', 'businessName'],
};

export class PayoutsService {
  async list(query: { page: number; limit: number }, vendorId?: string | null) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await Payout.findAndCountAll({
      where: vendorId ? { vendorId } : undefined,
      include: [vendorInclude],
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
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
      include: [vendorInclude],
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) => serializePayout(row));
  }

  async process(actorId: string) {
    const ledgers = await CommissionLedger.findAll({
      where: { status: COMMISSION_STATUS.PENDING },
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
      try {
        const payout = await sequelize.transaction(async (transaction) => {
          const locked = await CommissionLedger.findAll({
            where: {
              id: { [Op.in]: group.rows.map((row) => row.id) },
              status: COMMISSION_STATUS.PENDING,
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          if (!locked.length) {
            throw new Error('No pending commission ledgers');
          }

          const amount = locked.reduce(
            (sum, row) => sum + (Number(row.saleAmount) - Number(row.commissionAmount)),
            0,
          );
          const row = await Payout.create(
            {
              vendorId,
              amount,
              periodStart: group.start,
              periodEnd: group.end,
              status: PAYOUT_STATUS.PAID,
              createdBy: actorId,
            },
            { transaction },
          );
          await CommissionLedger.update(
            { status: COMMISSION_STATUS.SETTLED, updatedBy: actorId },
            { where: { id: locked.map((item) => item.id) }, transaction },
          );
          return row;
        });

        created.push(payout);
        const ownerId = await findVendorOwnerUserId(vendorId);
        if (ownerId) {
          void notificationsService.sendPayoutProcessed(ownerId, payout.id, {
            amount: Number(payout.amount),
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Payout processing failed';
        logger.warn('Payout processing failed for vendor', { vendorId, reason });
        const failed = await Payout.create({
          vendorId,
          amount: group.amount,
          periodStart: group.start,
          periodEnd: group.end,
          status: PAYOUT_STATUS.FAILED,
          createdBy: actorId,
        });
        const ownerId = await findVendorOwnerUserId(vendorId);
        if (ownerId) {
          void notificationsService.sendPayoutFailed(ownerId, failed.id, {
            amount: Number(failed.amount),
            reason,
          });
        }
      }
    }

    return created;
  }
}

export const payoutsService = new PayoutsService();
