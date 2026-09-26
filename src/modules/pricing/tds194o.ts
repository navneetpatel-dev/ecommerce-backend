import { QueryTypes, type Transaction } from 'sequelize';
import { COMMISSION_REFERENCE_TYPE, ORDER_STATUS, VENDOR_ENTITY_TYPE } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { istFinancialYearStart } from './istCalendar';
import { toPaise, type Paise } from './money';

/**
 * Whether a sale qualifies for the s.194-O(4) exemption: the seller is an individual
 * (sole proprietor, with PAN/Aadhaar on file — the KYC gate guarantees it) and their
 * gross sales through the platform this financial year, including this sale, stay
 * within the threshold. Cancelled and RTO'd parts do not count, and returns reduce it.
 */
export function qualifiesFor194oExemption(input: {
  entityType: string | null | undefined;
  financialYearGrossPaise: Paise;
  saleTaxablePaise: Paise;
  thresholdRupees: number;
}): boolean {
  if (input.entityType !== VENDOR_ENTITY_TYPE.SOLE_PROPRIETORSHIP) return false;
  const thresholdPaise = toPaise(Number(input.thresholdRupees) || 0);
  if (thresholdPaise <= 0) return false;
  return input.financialYearGrossPaise + input.saleTaxablePaise <= thresholdPaise;
}

/** A vendor's gross platform sales (value excluding GST) so far this Indian financial year. */
export async function vendorFinancialYearGrossPaise(
  vendorId: string,
  at: Date,
  transaction?: Transaction,
): Promise<Paise> {
  const rows = await sequelize.query<{ grossPaise: string | number | null }>(
    `SELECT COALESCE(SUM(cl."taxableAmountPaise"), 0)::bigint AS "grossPaise"
       FROM commission_ledgers cl
       INNER JOIN sub_orders s ON s.id = cl."subOrderId"
      WHERE cl."vendorId" = :vendorId
        AND cl."deletedAt" IS NULL
        AND cl."createdAt" >= :fyStart
        AND (cl."referenceType" IS NULL OR cl."referenceType" = :clawback)
        AND s.status NOT IN (:reversed)`,
    {
      replacements: {
        vendorId,
        fyStart: istFinancialYearStart(at),
        clawback: COMMISSION_REFERENCE_TYPE.RETURN_CLAWBACK,
        reversed: [ORDER_STATUS.CANCELLED, ORDER_STATUS.RETURNED],
      },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return Number(rows[0]?.grossPaise ?? 0);
}

/**
 * The TDS rate to freeze on a sale at checkout: 0 when the 194-O(4) exemption applies,
 * otherwise the platform rate.
 */
export async function tdsRateForSale(input: {
  vendorId: string;
  entityType: string | null | undefined;
  saleTaxablePaise: Paise;
  settings: { tdsRatePercent: number; tds194oExemptionThreshold?: number };
  at?: Date;
  transaction?: Transaction;
}): Promise<number> {
  const rate = Number(input.settings.tdsRatePercent ?? 0);
  const thresholdRupees = Number(input.settings.tds194oExemptionThreshold ?? 0);
  if (rate <= 0 || input.entityType !== VENDOR_ENTITY_TYPE.SOLE_PROPRIETORSHIP || thresholdRupees <= 0) {
    return rate;
  }
  const financialYearGrossPaise = await vendorFinancialYearGrossPaise(
    input.vendorId,
    input.at ?? new Date(),
    input.transaction,
  );
  return qualifiesFor194oExemption({
    entityType: input.entityType,
    financialYearGrossPaise,
    saleTaxablePaise: input.saleTaxablePaise,
    thresholdRupees,
  })
    ? 0
    : rate;
}
