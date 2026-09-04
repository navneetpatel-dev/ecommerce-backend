import { Op, type Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { DeliveryAgentEarning } from '@database/models/deliveryAgentEarning.model';
import { DeliveryAgentPayout } from '@database/models/deliveryAgentPayout.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { roundMoney } from '@modules/pricing/money';
import { settingsService } from '@modules/settings/settings.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { logAudit } from '@modules/audit/audit.service';
import type {
  MarkAgentPayoutFailedRequest,
  MarkAgentPayoutPaidRequest,
  UpdateBankDetailsRequest,
} from './deliveryAgentPayouts.dto';

function serializePayout(row: DeliveryAgentPayout) {
  const plain = row.get({ plain: true }) as Record<string, unknown> & {
    deliveryAgent?: { fullName?: string; hubOrZone?: string };
  };
  const { deliveryAgent, ...rest } = plain;
  return {
    ...rest,
    amount: roundMoney(rest.amount),
    agentName: deliveryAgent?.fullName ?? null,
    agentHubOrZone: deliveryAgent?.hubOrZone ?? null,
  };
}

const agentInclude = {
  model: DeliveryAgent,
  as: 'deliveryAgent' as const,
  attributes: ['id', 'fullName', 'hubOrZone'],
};

/**
 * Real earnings/payout ledger for delivery agents — mirrors the vendor
 * Payout/CommissionLedger operational pattern (per-task ledger row → batch
 * process → mark paid/failed → retry). Deliberately omits the GST/TDS/
 * commission-invoice machinery from vendor payouts: that's specific to
 * marketplace commission settlement under Section 194-O and does not apply
 * to a flat delivery-task wage.
 */
export class DeliveryAgentPayoutsService {
  /** Credits one task's flat rate to the ledger — called from confirmDelivery/confirmPickup. */
  async recordEarning(
    deliveryAgentId: string,
    sourceType: 'DELIVERY' | 'PICKUP',
    sourceId: string,
    transaction?: Transaction,
  ): Promise<DeliveryAgentEarning | null> {
    const settings = await settingsService.getPlatformSettings();
    const amount = Number(settings.deliveryAgentPerTaskEarning ?? 0);
    if (amount <= 0) return null;
    try {
      return await DeliveryAgentEarning.create(
        {
          deliveryAgentId,
          sourceType,
          sourceId,
          amount,
          status: 'PENDING',
          payoutId: null,
          earnedAt: new Date(),
          createdBy: deliveryAgentId,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction },
      );
    } catch {
      // Unique (sourceType, sourceId) constraint — already recorded, safe to ignore.
      return null;
    }
  }

  async list(query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await DeliveryAgentPayout.findAndCountAll({
      include: [agentInclude],
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    return {
      payouts: rows.map(serializePayout),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async listForAgent(deliveryAgentId: string) {
    const rows = await DeliveryAgentPayout.findAll({
      where: { deliveryAgentId },
      order: [['createdAt', 'DESC']],
    });
    return rows.map(serializePayout);
  }

  async earningsForAgent(deliveryAgentId: string) {
    return DeliveryAgentEarning.findAll({
      where: { deliveryAgentId },
      order: [['earnedAt', 'DESC']],
      limit: 100,
    });
  }

  async getBankDetails(deliveryAgentId: string): Promise<Record<string, unknown> | null> {
    const agent = await DeliveryAgent.findByPk(deliveryAgentId, { attributes: ['bankDetails'] });
    if (!agent) throw new NotFoundError('DeliveryAgent');
    return agent.bankDetails ?? null;
  }

  async updateBankDetails(
    deliveryAgentId: string,
    input: UpdateBankDetailsRequest,
    actorId: string,
  ): Promise<Record<string, unknown> | null> {
    const agent = await DeliveryAgent.findByPk(deliveryAgentId);
    if (!agent) throw new NotFoundError('DeliveryAgent');
    await agent.update({ bankDetails: input, updatedBy: actorId });
    return agent.bankDetails ?? null;
  }

  /** Groups every PENDING earning by agent and opens one payout batch per agent. */
  async process(actorId: string) {
    const pending = await DeliveryAgentEarning.findAll({ where: { status: 'PENDING' } });
    const grouped = new Map<string, { amount: number; start: Date; end: Date; ids: string[] }>();
    for (const row of pending) {
      const current = grouped.get(row.deliveryAgentId) ?? {
        amount: 0,
        start: row.earnedAt,
        end: row.earnedAt,
        ids: [] as string[],
      };
      current.amount += Number(row.amount);
      current.start = current.start < row.earnedAt ? current.start : row.earnedAt;
      current.end = current.end > row.earnedAt ? current.end : row.earnedAt;
      current.ids.push(row.id);
      grouped.set(row.deliveryAgentId, current);
    }

    const created: DeliveryAgentPayout[] = [];
    for (const [deliveryAgentId, group] of grouped) {
      const payout = await sequelize.transaction(async (transaction) => {
        const locked = await DeliveryAgentEarning.findAll({
          where: { id: { [Op.in]: group.ids }, status: 'PENDING' },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!locked.length) throw new Error('No pending earnings');

        const amount = roundMoney(locked.reduce((sum, row) => sum + Number(row.amount), 0));
        const payoutRow = await DeliveryAgentPayout.create(
          {
            deliveryAgentId,
            amount,
            periodStart: group.start,
            periodEnd: group.end,
            status: 'PENDING',
            paymentMethod: null,
            paymentReferenceNumber: null,
            proofOfPaymentUrl: null,
            remarks: null,
            failureReason: null,
            paidByAdminId: null,
            paidAt: null,
            createdBy: actorId,
            updatedBy: null,
            deletedBy: null,
          },
          { transaction },
        );
        await DeliveryAgentEarning.update(
          { status: 'SETTLED', payoutId: payoutRow.id, updatedBy: actorId },
          { where: { id: locked.map((row) => row.id) }, transaction },
        );
        return payoutRow;
      });

      created.push(payout);
      const agent = await DeliveryAgent.findByPk(deliveryAgentId, { attributes: ['userId'] });
      if (agent) {
        void notificationsService.sendPayoutProcessed(agent.userId, payout.id, {
          amount: Number(payout.amount),
        });
      }
    }

    return created.map(serializePayout);
  }

  async markPaid(payoutId: string, actorId: string, input: MarkAgentPayoutPaidRequest) {
    const updated = await sequelize.transaction(async (transaction) => {
      const payout = await DeliveryAgentPayout.findByPk(payoutId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!payout) throw new NotFoundError('DeliveryAgentPayout');
      if (payout.status !== 'PENDING') {
        throw new ValidationError(ERROR_MESSAGES.PAYOUT_INVALID_TRANSITION);
      }
      await payout.update(
        {
          status: 'PAID',
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
        action: 'AGENT_PAYOUT_MARKED_PAID',
        entityType: 'DeliveryAgentPayout',
        entityId: payout.id,
        metadata: {
          deliveryAgentId: payout.deliveryAgentId,
          amount: Number(payout.amount),
          paymentMethod: input.paymentMethod,
          paymentReferenceNumber: input.paymentReferenceNumber,
        },
        transaction,
      });
      return payout;
    });

    const agent = await DeliveryAgent.findByPk(updated.deliveryAgentId, { attributes: ['userId'] });
    if (agent) {
      void notificationsService.sendPayoutPaid(agent.userId, updated.id, {
        amount: Number(updated.amount),
        paymentMethod: updated.paymentMethod,
        paymentReferenceNumber: updated.paymentReferenceNumber,
        paidAt: updated.paidAt,
      });
    }
    return serializePayout(updated);
  }

  async markFailed(payoutId: string, actorId: string, input: MarkAgentPayoutFailedRequest) {
    const updated = await sequelize.transaction(async (transaction) => {
      const payout = await DeliveryAgentPayout.findByPk(payoutId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!payout) throw new NotFoundError('DeliveryAgentPayout');
      if (payout.status !== 'PENDING') {
        throw new ValidationError(ERROR_MESSAGES.PAYOUT_INVALID_TRANSITION);
      }
      await payout.update(
        { status: 'FAILED', failureReason: input.reason, updatedBy: actorId },
        { transaction },
      );
      await logAudit({
        actorId,
        action: 'AGENT_PAYOUT_MARKED_FAILED',
        entityType: 'DeliveryAgentPayout',
        entityId: payout.id,
        metadata: { deliveryAgentId: payout.deliveryAgentId, amount: Number(payout.amount), reason: input.reason },
        transaction,
      });
      return payout;
    });

    const agent = await DeliveryAgent.findByPk(updated.deliveryAgentId, { attributes: ['userId'] });
    if (agent) {
      void notificationsService.sendPayoutFailed(agent.userId, updated.id, {
        amount: Number(updated.amount),
        reason: input.reason,
      });
    }
    return serializePayout(updated);
  }

  async retry(payoutId: string, actorId: string) {
    return sequelize.transaction(async (transaction) => {
      const payout = await DeliveryAgentPayout.findByPk(payoutId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!payout) throw new NotFoundError('DeliveryAgentPayout');
      if (payout.status !== 'FAILED') {
        throw new ValidationError(ERROR_MESSAGES.PAYOUT_INVALID_TRANSITION);
      }
      const previousFailureReason = payout.failureReason;
      await payout.update(
        { status: 'PENDING', failureReason: null, updatedBy: actorId },
        { transaction },
      );
      await logAudit({
        actorId,
        action: 'AGENT_PAYOUT_RETRIED',
        entityType: 'DeliveryAgentPayout',
        entityId: payout.id,
        metadata: { previousFailureReason },
        transaction,
      });
      return serializePayout(payout);
    });
  }
}

export const deliveryAgentPayoutsService = new DeliveryAgentPayoutsService();
