import type { Transaction } from 'sequelize';
import { COMMISSION_STATUS } from '@core/constants/statuses';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { TdsLedger } from '@database/models/tdsLedger.model';

/**
 * Undoes what a payout run recorded for a payout the bank transfer failed for, so the
 * vendor is paid by the next run: its ledger rows go back to PENDING, and its 194-O TDS
 * and commission invoices are voided (TDS is deducted, and commission invoiced, when the
 * vendor is actually paid; the next run deducts and invoices again). Rows settled before
 * ledgers recorded their payout can't be traced and stay as they are.
 */
export async function undoFailedPayout(
  payoutId: string,
  actorId: string,
  transaction: Transaction,
): Promise<{ ledgersReopened: number; tdsVoided: number; invoicesVoided: number }> {
  const [ledgersReopened] = await CommissionLedger.update(
    { status: COMMISSION_STATUS.PENDING, payoutId: null, updatedBy: actorId },
    { where: { payoutId, status: COMMISSION_STATUS.SETTLED }, transaction },
  );
  const tdsVoided = await TdsLedger.destroy({ where: { payoutId }, transaction });
  const invoicesVoided = await CommissionInvoice.destroy({ where: { payoutId }, transaction });
  return { ledgersReopened, tdsVoided, invoicesVoided };
}
