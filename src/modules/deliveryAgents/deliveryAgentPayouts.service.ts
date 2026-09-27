import { Op, type Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { DeliveryAgentEarning } from '@database/models/deliveryAgentEarning.model';
import { DeliveryAgentPayout } from '@database/models/deliveryAgentPayout.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { fromPaise, roundMoney, toPaise } from '@modules/pricing/money';
import { istFinancialYearStart } from '@modules/pricing/istCalendar';
import { tds194cForPayout, tds194cRate } from './tds194c';
import { settingsService } from '@modules/settings/settings.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import { logAudit } from '@modules/audit/audit.service';
import { renderReportTablePdf } from '@core/pdf';
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
    tdsAmount: roundMoney(rest.tdsAmount ?? 0),
    tdsRatePercent: rest.tdsRatePercent == null ? null : Number(rest.tdsRatePercent),
    netAmount: roundMoney(rest.netAmount ?? rest.amount),
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
 * process → mark paid/failed → retry). Agents are contractors, so TDS under
 * s.194C is deducted from each payout once its limits are crossed (see
 * tds194c.ts); the marketplace machinery of vendor payouts (194-O, GST on
 * commission) does not apply to a flat delivery-task fee.
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

  /** PDF statement for one payout batch — reuses the generic report-table PDF renderer. */
  async renderStatement(
    payoutId: string,
    requesterDeliveryAgentId?: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const payout = await DeliveryAgentPayout.findByPk(payoutId, { include: [agentInclude] });
    if (!payout) throw new NotFoundError('DeliveryAgentPayout');
    if (requesterDeliveryAgentId && payout.deliveryAgentId !== requesterDeliveryAgentId) {
      throw new NotFoundError('DeliveryAgentPayout');
    }

    const earnings = await DeliveryAgentEarning.findAll({
      where: { payoutId },
      order: [['earnedAt', 'ASC']],
    });
    const plain = payout.get({ plain: true }) as Record<string, unknown> & {
      deliveryAgent?: { fullName?: string };
    };
    const agentName = plain.deliveryAgent?.fullName ?? 'Delivery agent';

    const buffer = await renderReportTablePdf({
      title: 'Delivery Payout Statement',
      subtitle: `${agentName} · ${new Date(payout.periodStart).toLocaleDateString()} – ${new Date(payout.periodEnd).toLocaleDateString()} · Status: ${payout.status}`,
      columns: [
        { key: 'taskType', label: 'Task', align: 'left' },
        { key: 'date', label: 'Date', align: 'left' },
        { key: 'amount', label: 'Amount (Rs.)', align: 'right' },
      ],
      rows: [
        ...earnings.map((row) => ({
          taskType: row.sourceType === 'DELIVERY' ? 'Delivery' : 'Return pickup',
          date: new Date(row.earnedAt).toLocaleDateString(),
          amount: Number(row.amount).toFixed(2),
        })),
        // Totals: gross earnings, TDS u/s 194C and the net amount paid.
        { taskType: 'Total earnings', date: '', amount: Number(payout.amount).toFixed(2) },
        {
          taskType:
            Number(payout.tdsAmount ?? 0) > 0
              ? `Less TDS u/s 194C @ ${Number(payout.tdsRatePercent ?? 0)}%`
              : 'Less TDS u/s 194C',
          date: '',
          amount: (-Number(payout.tdsAmount ?? 0)).toFixed(2),
        },
        { taskType: 'Net paid', date: '', amount: Number(payout.netAmount ?? payout.amount).toFixed(2) },
      ],
      emptyMessage: 'No settled tasks on this payout.',
    });

    return {
      buffer,
      filename: `payout-statement-${payout.id.slice(0, 8)}.pdf`,
    };
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
    const grouped = new Map<string, { start: Date; end: Date; ids: string[] }>();
    for (const row of pending) {
      const current = grouped.get(row.deliveryAgentId) ?? {
        start: row.earnedAt,
        end: row.earnedAt,
        ids: [] as string[],
      };
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

        const grossPaise = locked.reduce((sum, row) => sum + toPaise(roundMoney(row.amount)), 0);
        const tds = await this.tdsForPayout(deliveryAgentId, grossPaise, transaction);
        const payoutRow = await DeliveryAgentPayout.create(
          {
            deliveryAgentId,
            amount: fromPaise(grossPaise),
            tdsAmount: fromPaise(tds.tdsPaise),
            tdsRatePercent: tds.tdsPaise > 0 ? tds.ratePercent : null,
            netAmount: fromPaise(grossPaise - tds.tdsPaise),
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
        // What the agent will receive, after TDS.
        void notificationsService.sendPayoutProcessed(agent.userId, payout.id, {
          amount: Number(payout.netAmount),
        });
      }
    }

    return created.map(serializePayout);
  }

  /**
   * TDS u/s 194C for a new payout of `grossPaise`: against the agent's payouts earlier
   * this financial year (IST), at the contractor rate with a PAN on file, else s.206AA's.
   */
  private async tdsForPayout(
    deliveryAgentId: string,
    grossPaise: number,
    transaction: Transaction,
  ): Promise<{ tdsPaise: number; ratePercent: number }> {
    const settings = await settingsService.getPlatformSettings();
    const agent = await DeliveryAgent.findByPk(deliveryAgentId, { attributes: ['bankDetails'], transaction });
    const ratePercent = tds194cRate(agent?.bankDetails?.pan, settings);
    const earlier = await DeliveryAgentPayout.findAll({
      where: { deliveryAgentId, createdAt: { [Op.gte]: istFinancialYearStart(new Date()) } },
      attributes: ['amount', 'tdsAmount'],
      transaction,
    });
    const tdsPaise = tds194cForPayout({
      grossPaise,
      financialYearGrossPaise: earlier.reduce((sum, row) => sum + toPaise(roundMoney(row.amount)), 0),
      financialYearTdsPaise: earlier.reduce((sum, row) => sum + toPaise(roundMoney(row.tdsAmount ?? 0)), 0),
      ratePercent,
      singleThresholdPaise: toPaise(Number(settings.deliveryAgentTdsSingleThreshold) || 0),
      annualThresholdPaise: toPaise(Number(settings.deliveryAgentTdsAnnualThreshold) || 0),
    });
    return { tdsPaise, ratePercent };
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
          tdsAmount: Number(payout.tdsAmount ?? 0),
          netAmount: Number(payout.netAmount),
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
        amount: Number(updated.netAmount),
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
        amount: Number(updated.netAmount),
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
