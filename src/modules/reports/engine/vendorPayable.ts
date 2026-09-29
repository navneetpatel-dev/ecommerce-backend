import { Op, literal } from 'sequelize';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Vendor } from '@database/models/vendor.model';
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
      ],
    }),
    Vendor.findAll({ where: { id: { [Op.in]: vendorIds } }, attributes: ['id', 'state'] }),
    settingsService.getPlatformSettings(),
  ]);
  const stateById = new Map(vendors.map((vendor) => [vendor.id, vendor.state ?? null]));
  const byVendor = new Map<string, CommissionLedger[]>();
  for (const ledger of ledgers) {
    const rows = byVendor.get(ledger.vendorId) ?? [];
    rows.push(ledger);
    byVendor.set(ledger.vendorId, rows);
  }
  for (const vendorId of vendorIds) {
    const rows = byVendor.get(vendorId) ?? [];
    const breakdown = vendorPayoutBreakdown(
      rows,
      payoutRatesFromSettings(settings, stateById.get(vendorId) ?? null),
    );
    result.set(vendorId, breakdown.payoutPaise);
  }
  return result;
}
