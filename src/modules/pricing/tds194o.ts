import { QueryTypes, type Transaction } from 'sequelize';
import {
  COMMISSION_REFERENCE_TYPE,
  COMMISSION_STATUS,
  ORDER_STATUS,
  VENDOR_ENTITY_TYPE,
} from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { PAID_OR_COD_ORDER_SQL } from './frozenMoneySql';
import { istFinancialYearStart } from './istCalendar';
import { toPaise, type Paise } from './money';

/**
 * Whether a sale qualifies for the s.194-O(4) exemption: the seller is an individual
 * (sole proprietor, with PAN/Aadhaar on file — the KYC gate guarantees it) and their
 * gross sales through the platform this financial year, including this sale, stay
 * within the threshold. Cancelled and RTO'd parts and unpaid online checkouts do not
 * count, and returns reduce it.
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
    `SELECT COALESCE(SUM(COALESCE(cl."supplyTaxablePaise", cl."taxableAmountPaise")), 0)::bigint AS "grossPaise"
       FROM commission_ledgers cl
       INNER JOIN sub_orders s ON s.id = cl."subOrderId"
       INNER JOIN orders o ON o.id = s."orderId"
      WHERE cl."vendorId" = :vendorId
        AND ${PAID_OR_COD_ORDER_SQL}
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

/**
 * Section 194-O(4) catch-up for a payout, in paise. A sole proprietor's sales are TDS-free
 * while the financial year's sales stay within the exemption limit; once they cross it,
 * TDS applies to the year's sales as a whole, so the sales that were frozen as exempt
 * (rate 0) are taxed too. The catch-up is the TDS due on the exempt sales already paid
 * out or in this payout (`batchLedgerIds`), at the current rate, less the catch-up taken
 * by earlier payouts this year. Negative when returns shrank those sales since.
 * Zero for other vendors, or while the year's sales are within the limit.
 */
export async function tds194oCatchUp(input: {
  vendorId: string;
  entityType: string | null | undefined;
  settings: { tdsRatePercent: number; tds194oExemptionThreshold?: number };
  batchLedgerIds: string[];
  at?: Date;
  transaction?: Transaction;
}): Promise<{ basePaise: Paise; ratePercent: number; tdsPaise: Paise }> {
  const ratePercent = Number(input.settings.tdsRatePercent ?? 0);
  const thresholdPaise = toPaise(Number(input.settings.tds194oExemptionThreshold ?? 0));
  const none = { basePaise: 0, ratePercent, tdsPaise: 0 };
  if (
    ratePercent <= 0 ||
    thresholdPaise <= 0 ||
    input.entityType !== VENDOR_ENTITY_TYPE.SOLE_PROPRIETORSHIP
  ) {
    return none;
  }
  const at = input.at ?? new Date();
  const yearGrossPaise = await vendorFinancialYearGrossPaise(input.vendorId, at, input.transaction);
  if (yearGrossPaise <= thresholdPaise) return none;

  const fyStart = istFinancialYearStart(at);
  const rows = await sequelize.query<{ basePaise: string | number | null; takenPaise: string | number | null }>(
    `SELECT
       (SELECT COALESCE(SUM(COALESCE(cl."supplyTaxablePaise", cl."taxableAmountPaise")), 0)::bigint
          FROM commission_ledgers cl
          INNER JOIN sub_orders s ON s.id = cl."subOrderId"
          INNER JOIN orders o ON o.id = s."orderId"
         WHERE cl."vendorId" = :vendorId
           AND cl."deletedAt" IS NULL
           AND cl."createdAt" >= :fyStart
           AND ${PAID_OR_COD_ORDER_SQL}
           AND COALESCE(cl."tdsRatePercent", -1) = 0
           AND (cl."referenceType" IS NULL OR cl."referenceType" = :clawback)
           AND (cl.status = :settled OR cl.id IN (:batch))) AS "basePaise",
       (SELECT COALESCE(SUM(t."tdsAmountPaise"), 0)::bigint
          FROM tds_ledgers t
         WHERE t."vendorId" = :vendorId
           AND t."deletedAt" IS NULL
           AND t."commissionLedgerId" IS NULL
           AND t.section = '194O'
           AND t."createdAt" >= :fyStart) AS "takenPaise"`,
    {
      replacements: {
        vendorId: input.vendorId,
        fyStart,
        clawback: COMMISSION_REFERENCE_TYPE.RETURN_CLAWBACK,
        settled: COMMISSION_STATUS.SETTLED,
        // An empty IN () is invalid SQL: a nil uuid matches nothing.
        batch: input.batchLedgerIds.length ? input.batchLedgerIds : ['00000000-0000-0000-0000-000000000000'],
      },
      type: QueryTypes.SELECT,
      transaction: input.transaction,
    },
  );
  const basePaise = Number(rows[0]?.basePaise ?? 0);
  const takenPaise = Number(rows[0]?.takenPaise ?? 0);
  const duePaise = Math.round((Math.max(0, basePaise) * ratePercent) / 100);
  return { basePaise, ratePercent, tdsPaise: duePaise - takenPaise };
}
