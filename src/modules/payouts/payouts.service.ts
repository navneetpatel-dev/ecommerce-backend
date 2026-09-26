import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Payout } from '@database/models/payout.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Shipment } from '@database/models/shipment.model';
import { TdsLedger } from '@database/models/tdsLedger.model';
import { Vendor } from '@database/models/vendor.model';
import { sequelize } from '@database/models';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import {
  COMMISSION_STATUS,
  PAYOUT_STATUS,
  ORDER_STATUS,
  RETURN_STATUS,
  ROLES,
} from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { userHasPermission } from '@middleware/rbac.middleware';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { notificationsService } from '@modules/notifications/notifications.service';
import {
  findSuperAdminUserIds,
  findVendorOwnerUserId,
} from '@modules/notifications/orderNotifications';
import { logger } from '@core/logger';
import { Op } from 'sequelize';
import { settingsService } from '@modules/settings/settings.service';
import { fromPaise, roundMoney } from '@modules/pricing/money';
import { vendorNetPayoutPaise } from '@modules/pricing/frozenMoneySql';
import { payoutRatesFromSettings, vendorPayoutBreakdown } from '@modules/pricing/vendorPayout';
import { createCommissionInvoiceForPayout } from '@modules/commissions/commissionInvoice.service';
import { logAudit } from '@modules/audit/audit.service';
import type { MarkPayoutFailedRequest, MarkPayoutPaidRequest } from './payouts.dto';
import { subOrdersInReturnWindow, type DeliveredSubOrder } from './returnWindowHold';

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

/** Open returns still in flight — exclude these suborders from payout eligibility. */
const OPEN_PAYOUT_BLOCKING_RETURN_STATUSES = [
  RETURN_STATUS.REQUESTED,
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.PICKUP_SCHEDULED,
  RETURN_STATUS.RECEIVED,
] as const;

function payoutReturnWindowCutoff(defaultReturnWindowDays: number): Date {
  const days =
    Number.isFinite(defaultReturnWindowDays) && defaultReturnWindowDays > 0
      ? defaultReturnWindowDays
      : 7;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function openReturnNotExistsSql() {
  const statuses = OPEN_PAYOUT_BLOCKING_RETURN_STATUSES.map((status) => `'${status}'`).join(', ');
  return sequelize.literal(
    `NOT EXISTS (SELECT 1 FROM return_requests AS rr WHERE rr."subOrderId" = "SubOrder"."id" AND rr.status IN (${statuses}) AND rr."deletedAt" IS NULL)`,
  );
}

/** Shared SubOrder include for both payout candidate queries — do not duplicate. */
function payoutEligibleSubOrderInclude(windowCutoff: Date) {
  return {
    model: SubOrder,
    attributes: ['id', 'orderId', 'status'],
    required: true,
    where: {
      status: ORDER_STATUS.DELIVERED,
      [Op.and]: [openReturnNotExistsSql()],
    },
    include: [
      {
        model: Shipment,
        as: 'shipment' as const,
        attributes: ['id', 'deliveredAt'],
        required: true,
        where: {
          deliveredAt: { [Op.ne]: null, [Op.lte]: windowCutoff },
        },
      },
    ],
  };
}

/** Delivered sub-orders (with their delivery time) behind a set of candidate ledgers. */
function deliveredSubOrdersOf(ledgers: CommissionLedger[]): DeliveredSubOrder[] {
  const byId = new Map<string, DeliveredSubOrder>();
  for (const ledger of ledgers) {
    const { SubOrder: subOrder } = ledger as CommissionLedger & {
      SubOrder?: { shipment?: { deliveredAt?: Date | null } };
    };
    const deliveredAt = subOrder?.shipment?.deliveredAt;
    if (deliveredAt) {
      byId.set(ledger.subOrderId, { id: ledger.subOrderId, deliveredAt: new Date(deliveredAt) });
    }
  }
  return [...byId.values()];
}

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

  async listByVendor(
    vendorId: string,
    actor?: { id: string; vendorId?: string | null; role: { name: string }; roleId?: string } | string | null,
  ) {
    if (typeof actor === 'object' && actor) {
      const isAdmin =
        actor.role?.name === ROLES.SUPER_ADMIN ||
        (await userHasPermission(actor, PERMISSIONS.PAYOUT_MANAGE));
      if (!isAdmin) {
        if (!actor.vendorId || actor.vendorId !== vendorId) {
          throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_VENDOR_PAYOUTS);
        }
      }
    } else if (typeof actor === 'string') {
      if (actor !== vendorId) {
        throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_VENDOR_PAYOUTS);
      }
    } else if (!actor) {
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
    const payoutRates = payoutRatesFromSettings(settings);
    const windowCutoff = payoutReturnWindowCutoff(Number(settings.defaultReturnWindow ?? 7));
    const subOrderInclude = payoutEligibleSubOrderInclude(windowCutoff);
    const candidates = await CommissionLedger.findAll({
      where: { status: COMMISSION_STATUS.PENDING },
      include: [subOrderInclude],
    });
    // Also hold sales still inside their items' own (longer) category return window.
    const held = await subOrdersInReturnWindow(deliveredSubOrdersOf(candidates));
    const ledgers = candidates.filter((ledger) => !held.has(ledger.subOrderId));
    const grouped = new Map<string, { amountPaise: number; start: Date; end: Date; rows: CommissionLedger[] }>();
    for (const ledger of ledgers) {
      const current = grouped.get(ledger.vendorId) ?? {
        amountPaise: 0,
        start: ledger.createdAt,
        end: ledger.createdAt,
        rows: [],
      };
      current.amountPaise += vendorNetPayoutPaise(ledger);
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
            include: [subOrderInclude],
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          if (!locked.length) {
            throw new Error('No pending commission ledgers');
          }

          // Net less 194-O TDS on each sale's value, less GST on commission, less vendor-borne
          // cashback cost — the same breakdown the vendor dashboard shows as pending
          // (pricing/vendorPayout).
          const breakdown = vendorPayoutBreakdown(locked, payoutRates);
          if (breakdown.balancePaise < 0) {
            // Deductions (cashback cost, returns after payout) exceed what the sales
            // earned: pay nothing and leave every ledger pending, so they net against
            // the vendor's next sales.
            logger.info('Payout carried forward: vendor balance is negative', {
              vendorId,
              balancePaise: breakdown.balancePaise,
            });
            return null;
          }
          const amountPaise = breakdown.payoutPaise;
          const commissionTaxablePaise = breakdown.commissionTaxablePaise;
          const tdsRows: Array<{
            orderId: string;
            subOrderId: string;
            taxableAmountPaise: number;
            ratePercent: number;
            tdsAmountPaise: number;
          }> = [];
          locked.forEach((row, index) => {
            const { tdsBasePaise, tdsRatePercent, tdsPaise } = breakdown.rows[index]!;
            const subOrder = (row as any).SubOrder as SubOrder | undefined;
            if (tdsPaise > 0 && subOrder?.orderId) {
              tdsRows.push({
                orderId: subOrder.orderId,
                subOrderId: row.subOrderId,
                taxableAmountPaise: tdsBasePaise,
                ratePercent: tdsRatePercent,
                tdsAmountPaise: tdsPaise,
              });
            }
          });

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
                ratePercent: tds.ratePercent,
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

        if (!payout) continue;
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
          amount: fromPaise(group.amountPaise),
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
