import { Op, literal } from 'sequelize';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Vendor } from '@database/models/vendor.model';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import { COMMISSION_STATUS } from '@core/constants/statuses';
import { sqlLedgerOnPaidOrder } from '@modules/pricing/frozenMoneySql';
import { payoutRatesFromSettings, vendorPayoutBreakdown } from '@modules/pricing/vendorPayout';
import { settingsService } from '@modules/settings/settings.service';

type LedgerStatus = typeof COMMISSION_STATUS.PENDING | typeof COMMISSION_STATUS.SETTLED;

/**
 * What each vendor is (or was) paid for its ledgers of one status created in the range,
 * in paise: the payout run's own breakdown (pricing/vendorPayout) — net less 194-O TDS,
 * less GST on commission, with cashback costs and returns after payout — never the
 * ledgers' net before those. Only sales that are real money (COD or paid online).
 */
export async function vendorPayablePaise(
  vendorIds: string[],
  opts: { status: LedgerStatus; from: Date; to: Date },
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (vendorIds.length === 0) return result;
  const [ledgers, vendors, settings] = await Promise.all([
    CommissionLedger.findAll({
      where: {
        vendorId: { [Op.in]: vendorIds },
        status: opts.status,
        createdAt: { [Op.between]: [opts.from, opts.to] },
        [Op.and]: [literal(sqlLedgerOnPaidOrder('"CommissionLedger"'))],
      },
      attributes: [
        'vendorId',
        'netPayoutAmountPaise',
        'commissionAmountPaise',
        'taxableAmountPaise',
        'supplyTaxablePaise',
        'tdsRatePercent',
        'status',
        'referenceType',
        'payoutId',
      ],
    }),
    Vendor.findAll({ where: { id: { [Op.in]: vendorIds } }, attributes: ['id', 'state'] }),
    settingsService.getPlatformSettings(),
  ]);
  const stateById = new Map(vendors.map((vendor) => [vendor.id, vendor.state ?? null]));
  const rateByPayout = await commissionGstRateByPayout(ledgers);
  // Settled rows at the commission GST rate their payout charged (the 194-O rate is
  // already stamped on each sale): today's rate would rewrite what was paid. Rows
  // settled before ledgers recorded their payout, and pending ones, use today's.
  const groups = new Map<string, { vendorId: string; rate: number | null; rows: CommissionLedger[] }>();
  for (const ledger of ledgers) {
    const rate = ledger.payoutId ? (rateByPayout.get(ledger.payoutId) ?? null) : null;
    const key = `${ledger.vendorId}|${rate ?? ''}`;
    const group = groups.get(key) ?? { vendorId: ledger.vendorId, rate, rows: [] };
    group.rows.push(ledger);
    groups.set(key, group);
  }
  for (const vendorId of vendorIds) result.set(vendorId, 0);
  for (const { vendorId, rate, rows } of groups.values()) {
    const rates = payoutRatesFromSettings(
      rate == null ? settings : { ...settings, commissionGstRatePercent: rate },
      stateById.get(vendorId) ?? null,
    );
    result.set(vendorId, (result.get(vendorId) ?? 0) + vendorPayoutBreakdown(rows, rates).payoutPaise);
  }
  return result;
}

/** The commission GST rate each payout's commission invoice charged. */
async function commissionGstRateByPayout(ledgers: CommissionLedger[]): Promise<Map<string, number>> {
  const payoutIds = [...new Set(ledgers.map((ledger) => ledger.payoutId).filter((id): id is string => Boolean(id)))];
  if (payoutIds.length === 0) return new Map();
  const invoices = await CommissionInvoice.findAll({
    where: { payoutId: { [Op.in]: payoutIds } },
    attributes: ['payoutId', 'gstRatePercent'],
  });
  return new Map(invoices.map((invoice) => [String(invoice.payoutId), Number(invoice.gstRatePercent)]));
}
