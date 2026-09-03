import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Payout } from '@database/models/payout.model';
import { SubOrder } from '@database/models/subOrder.model';
import { TdsLedger } from '@database/models/tdsLedger.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { COMMISSION_STATUS, PAYOUT_STATUS } from '@core/constants/statuses';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { notificationsService } from '@modules/notifications/notifications.service';
import {
  findSuperAdminUserIds,
  findVendorOwnerUserId,
} from '@modules/notifications/orderNotifications';
import { logger } from '@core/logger';
import { Op } from 'sequelize';
import { settingsService } from '@modules/settings/settings.service';
import { fromPaise, toPaise, roundMoney } from '@modules/pricing/money';
import {
  computeCommissionGstPaise,
  createCommissionInvoiceForPayout,
} from '@modules/commissions/commissionInvoice.service';
import { logAudit } from '@modules/audit/audit.service';
import type { MarkPayoutFailedRequest, MarkPayoutPaidRequest } from './payouts.dto';

async function notifyPayoutFailed(params: {
  vendorId: string;
  payoutId: string;
  amount: number;
  reason: string;
  businessName?: string | null;
}) {
  const templateData = {
    amount: params.amount,
    reason: params.reason,
    businessName: params.businessName ?? undefined,
    vendorId: params.vendorId,
  };
  const ownerId = await findVendorOwnerUserId(params.vendorId);
  if (ownerId) {
    void notificationsService.sendPayoutFailed(ownerId, params.payoutId, templateData);
  }
  const adminIds = await findSuperAdminUserIds();
  for (const adminId of adminIds) {
    void notificationsService.sendPayoutFailed(adminId, params.payoutId, templateData);
  }
}

function serializePayout(row: Payout) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  const { Vendor: vendorAssoc, ...rest } = plain;
  return {
    ...rest,
    amount: roundMoney(plain.amount),
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
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_VENDOR_PAYOUTS);
    }
    const rows = await Payout.findAll({
      where: { vendorId },
      include: [vendorInclude],
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) => serializePayout(row));
  }

  async process(actorId: string) {
    const settings = await settingsService.getPlatformSettings();
    const tdsRate = Number(settings.tdsRatePercent ?? 0);
    const ledgers = await CommissionLedger.findAll({
      where: { status: COMMISSION_STATUS.PENDING },
      include: [{ model: SubOrder, attributes: ['id', 'orderId'] }],
    });
    const grouped = new Map<string, { amount: number; start: Date; end: Date; rows: CommissionLedger[] }>();
    for (const ledger of ledgers) {
      const current = grouped.get(ledger.vendorId) ?? {
        amount: 0,
        start: ledger.createdAt,
        end: ledger.createdAt,
        rows: [],
      };
      current.amount +=
        ledger.netPayoutAmount != null
          ? Number(ledger.netPayoutAmount)
          : Number(ledger.saleAmount) - Number(ledger.commissionAmount);
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
            include: [{ model: SubOrder, attributes: ['id', 'orderId'] }],
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          if (!locked.length) {
            throw new Error('No pending commission ledgers');
          }

          let amountPaise = 0;
          let commissionTaxablePaise = 0;
          const tdsRows: Array<{
            orderId: string;
            subOrderId: string;
            taxableAmountPaise: number;
            tdsAmountPaise: number;
          }> = [];
          for (const row of locked) {
            const netPaise =
              row.netPayoutAmountPaise != null && Number(row.netPayoutAmountPaise) > 0
                ? Number(row.netPayoutAmountPaise)
                : toPaise(
                    row.netPayoutAmount != null
                      ? Number(row.netPayoutAmount)
                      : Number(row.saleAmount) - Number(row.commissionAmount),
                  );
            const taxablePaise =
              row.taxableAmountPaise != null && Number(row.taxableAmountPaise) > 0
                ? Number(row.taxableAmountPaise)
                : toPaise(Number(row.taxableAmount ?? row.saleAmount));
            const commissionPaise =
              row.commissionAmountPaise != null && Number(row.commissionAmountPaise) > 0
                ? Number(row.commissionAmountPaise)
                : toPaise(Number(row.commissionAmount ?? 0));
            commissionTaxablePaise += commissionPaise;
            // Section 194-O: TDS on gross vendor payout (net before TDS).
            const grossPayoutPaise = netPaise;
            const tdsPaise =
              tdsRate > 0 ? Math.round((grossPayoutPaise * tdsRate) / 100) : 0;
            amountPaise += Math.max(0, netPaise - tdsPaise);

            if (tdsPaise > 0) {
              const subOrder = (row as any).SubOrder as SubOrder | undefined;
              if (subOrder?.orderId) {
                tdsRows.push({
                  orderId: subOrder.orderId,
                  subOrderId: row.subOrderId,
                  taxableAmountPaise: grossPayoutPaise,
                  tdsAmountPaise: tdsPaise,
                });
              }
            }
          }

          // Deduct GST on marketplace commission from vendor settlement.
          const { gstPaise: commissionGstPaise } =
            await computeCommissionGstPaise(commissionTaxablePaise);
          amountPaise = Math.max(0, amountPaise - commissionGstPaise);

          const amount = fromPaise(amountPaise);
          const payoutRow = await Payout.create(
            {
              vendorId,
              amount,
              periodStart: group.start,
              periodEnd: group.end,
              status: PAYOUT_STATUS.PENDING,
              preparedAt: new Date(),
              createdBy: actorId,
            },
            { transaction },
          );

          await createCommissionInvoiceForPayout(
            {
              vendorId,
              payoutId: payoutRow.id,
              periodStart: group.start,
              periodEnd: group.end,
              commissionTaxablePaise,
              actorId,
            },
            transaction,
          );

          const period = new Date(group.end).toISOString().slice(0, 7);
          for (const tds of tdsRows) {
            await TdsLedger.create(
              {
                orderId: tds.orderId,
                subOrderId: tds.subOrderId,
                vendorId,
                payoutId: payoutRow.id,
                taxableAmountPaise: tds.taxableAmountPaise,
                ratePercent: tdsRate,
                tdsAmountPaise: tds.tdsAmountPaise,
                section: '194O',
                period,
                createdBy: actorId,
                updatedBy: actorId,
                deletedBy: null,
              },
              { transaction },
            );
          }

          await CommissionLedger.update(
            { status: COMMISSION_STATUS.SETTLED, updatedBy: actorId },
            { where: { id: locked.map((item) => item.id) }, transaction },
          );
          return payoutRow;
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
          failureReason: reason,
          createdBy: actorId,
        });
        const vendor = await Vendor.findByPk(vendorId, { attributes: ['businessName'] });
        void notifyPayoutFailed({
          vendorId,
          payoutId: failed.id,
          amount: Number(failed.amount),
          reason,
          businessName: vendor?.businessName,
        });
      }
    }

    return created;
  }

  async markPaid(payoutId: string, actorId: string, input: MarkPayoutPaidRequest) {
    const updated = await sequelize.transaction(async (transaction) => {
      const payout = await Payout.findByPk(payoutId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!payout) throw new NotFoundError('Payout');
      if (payout.status !== PAYOUT_STATUS.PENDING) {
        throw new ValidationError(ERROR_MESSAGES.PAYOUT_INVALID_TRANSITION);
      }

      await payout.update(
        {
          status: PAYOUT_STATUS.PAID,
          paymentMethod: input.paymentMethod,
          paymentReferenceNumber: input.paymentReferenceNumber,
          proofOfPaymentUrl: input.proofOfPaymentUrl ?? null,
          remarks: input.remarks ?? null,
          failureReason: null,
          paidByAdminId: actorId,
          paidAt: input.paidAt ?? new Date(),
          updatedBy: actorId,
        },
        { transaction },
      );
      await logAudit({
        actorId,
        action: 'PAYOUT_MARKED_PAID',
        entityType: 'Payout',
        entityId: payout.id,
        metadata: {
          vendorId: payout.vendorId,
          amount: Number(payout.amount),
          paymentMethod: input.paymentMethod,
          paymentReferenceNumber: input.paymentReferenceNumber,
        },
        transaction,
      });
      return payout;
    });

    const ownerId = await findVendorOwnerUserId(updated.vendorId);
    if (ownerId) {
      void notificationsService.sendPayoutPaid(ownerId, updated.id, {
        amount: Number(updated.amount),
        paymentMethod: updated.paymentMethod,
        paymentReferenceNumber: updated.paymentReferenceNumber,
        paidAt: updated.paidAt,
      });
    }
    return serializePayout(updated);
  }

  async markFailed(payoutId: string, actorId: string, input: MarkPayoutFailedRequest) {
    const updated = await sequelize.transaction(async (transaction) => {
      const payout = await Payout.findByPk(payoutId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!payout) throw new NotFoundError('Payout');
      if (payout.status !== PAYOUT_STATUS.PENDING) {
        throw new ValidationError(ERROR_MESSAGES.PAYOUT_INVALID_TRANSITION);
      }
      await payout.update(
        { status: PAYOUT_STATUS.FAILED, failureReason: input.reason, updatedBy: actorId },
        { transaction },
      );
      await logAudit({
        actorId,
        action: 'PAYOUT_MARKED_FAILED',
        entityType: 'Payout',
        entityId: payout.id,
        metadata: { vendorId: payout.vendorId, amount: Number(payout.amount), reason: input.reason },
        transaction,
      });
      return payout;
    });

    const vendor = await Vendor.findByPk(updated.vendorId, { attributes: ['businessName'] });
    void notifyPayoutFailed({
      vendorId: updated.vendorId,
      payoutId: updated.id,
      amount: Number(updated.amount),
      reason: input.reason,
      businessName: vendor?.businessName,
    });
    return serializePayout(updated);
  }

  async retry(payoutId: string, actorId: string) {
    return sequelize.transaction(async (transaction) => {
      const payout = await Payout.findByPk(payoutId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!payout) throw new NotFoundError('Payout');
      if (payout.status !== PAYOUT_STATUS.FAILED) {
        throw new ValidationError(ERROR_MESSAGES.PAYOUT_INVALID_TRANSITION);
      }
      if (!payout.preparedAt) {
        throw new ValidationError(ERROR_MESSAGES.PAYOUT_INVALID_TRANSITION);
      }
      const previousFailureReason = payout.failureReason;
      await payout.update(
        { status: PAYOUT_STATUS.PENDING, failureReason: null, updatedBy: actorId },
        { transaction },
      );
      await logAudit({
        actorId,
        action: 'PAYOUT_RETRIED',
        entityType: 'Payout',
        entityId: payout.id,
        metadata: { previousFailureReason },
        transaction,
      });
      return serializePayout(payout);
    });
  }
}

export const payoutsService = new PayoutsService();
