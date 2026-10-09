import { Op, QueryTypes } from 'sequelize';
import { Coupon } from '@database/models/coupon.model';
import { CouponBatch } from '@database/models/couponBatch.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { sequelize } from '@database/models';
import { fromPaise } from '@modules/pricing/money';
import { REPORTABLE_ORDER_SQL, sqlOrderKeptPaymentPaise } from '@modules/pricing/frozenMoneySql';
import { sqlKeptCouponDiscountPaise } from './couponDiscountSql';

export interface CouponBatchView {
  id: string;
  name: string;
  templateCouponConfig: Record<string, unknown>;
  generatedCount: number;
  createdById: string;
  createdAt: Date;
  updatedAt?: Date;
  redemptionCount: number;
  discountTotal: number;
  revenueImpact: number;
  codes: string[];
  expiresAt: string | null;
}

/**
 * Per-batch variant of `couponUsageMoney()`: same math, one query for every batch
 * (`GROUP BY c."batchId"`), so listing 100 batches costs 3 queries total instead of
 * three per batch. An order that redeemed coupons from two batches counts in both
 * batches — identical to calling `couponUsageMoney` per batch.
 */
async function couponUsageMoneyByBatch(couponIds: string[]): Promise<Map<string, { discountTotal: number; revenueImpact: number }>> {
  const result = new Map<string, { discountTotal: number; revenueImpact: number }>();
  if (couponIds.length === 0) return result;
  const rows = await sequelize.query<{
    batchId: string;
    discountPaise: string;
    paymentPaise: string;
  }>(
    `WITH usages AS (
       SELECT c."batchId", cu."orderId", SUM(${sqlKeptCouponDiscountPaise()})::bigint AS "discountPaise"
       FROM coupon_usages cu
       INNER JOIN coupons c ON c.id = cu."couponId"
       WHERE cu."couponId" IN (:couponIds)
         AND cu."deletedAt" IS NULL
       GROUP BY c."batchId", cu."orderId"
     )
     SELECT
       u."batchId",
       COALESCE(SUM(u."discountPaise"), 0)::bigint AS "discountPaise",
       COALESCE(SUM(${sqlOrderKeptPaymentPaise('o')}), 0)::bigint AS "paymentPaise"
     FROM usages u
     INNER JOIN orders o ON o.id = u."orderId" AND o."deletedAt" IS NULL
     WHERE ${REPORTABLE_ORDER_SQL}
     GROUP BY u."batchId"`,
    { replacements: { couponIds }, type: QueryTypes.SELECT },
  );
  for (const row of rows) {
    result.set(row.batchId, {
      discountTotal: fromPaise(Number(row.discountPaise ?? 0)),
      revenueImpact: fromPaise(Number(row.paymentPaise ?? 0)),
    });
  }
  return result;
}

/**
 * Coupon-batch list view models (admin listBatches). Batched form of the previous
 * per-batch loop: one coupons fetch, one grouped usage count, one grouped money
 * query — semantics unchanged, including the `forceVendorId` skip rule.
 */
export async function listCouponBatchViews(
  opts: {
    forceVendorId?: string | null;
  } = {},
): Promise<CouponBatchView[]> {
  const batches = await CouponBatch.findAll({
    order: [['createdAt', 'DESC']],
    limit: 100,
  });
  if (batches.length === 0) return [];

  const couponWhere: Record<string, unknown> = {
    batchId: { [Op.in]: batches.map((batch) => batch.id) },
  };
  if (opts.forceVendorId) couponWhere.vendorId = opts.forceVendorId;

  const coupons = await Coupon.findAll({
    where: couponWhere,
    attributes: ['id', 'code', 'usedCount', 'endDate', 'batchId'],
    order: [['code', 'ASC']],
  });

  const couponsByBatch = new Map<string, typeof coupons>();
  for (const coupon of coupons) {
    // Non-batch coupons can never appear under the batchId IN filter; the
    // guard exists purely to narrow the model's nullable column.
    if (!coupon.batchId) continue;
    const list = couponsByBatch.get(coupon.batchId) ?? [];
    list.push(coupon);
    couponsByBatch.set(coupon.batchId, list);
  }

  const couponIds = coupons.map((coupon) => coupon.id);
  const usageCountRows = couponIds.length
    ? await CouponUsage.findAll({
        attributes: ['couponId', [sequelize.fn('COUNT', sequelize.col('id')), 'usageCount']],
        where: { couponId: { [Op.in]: couponIds } },
        group: ['couponId'],
        raw: true,
      })
    : [];
  const usageCountByCoupon = new Map(
    (usageCountRows as unknown as Array<{ couponId: string; usageCount: string }>).map((row) => [row.couponId, Number(row.usageCount)]),
  );
  const usageMoneyByBatch = await couponUsageMoneyByBatch(couponIds);

  const result: CouponBatchView[] = [];
  for (const batch of batches) {
    const batchCoupons = couponsByBatch.get(batch.id) ?? [];
    if (opts.forceVendorId && batchCoupons.length === 0) continue;

    const redemptionCount = batchCoupons.reduce((sum, coupon) => sum + (usageCountByCoupon.get(coupon.id) ?? 0), 0);
    const money = usageMoneyByBatch.get(batch.id) ?? {
      discountTotal: 0,
      revenueImpact: 0,
    };

    const expiresAt = batchCoupons.reduce(
      (earliest, row) => {
        const end = row.endDate;
        if (!earliest || end < earliest) return end;
        return earliest;
      },
      null as Date | null,
    );

    result.push({
      id: batch.id,
      name: batch.name,
      templateCouponConfig: batch.templateCouponConfig as Record<string, unknown>,
      generatedCount: batch.generatedCount,
      createdById: batch.createdById,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      redemptionCount,
      discountTotal: money.discountTotal,
      revenueImpact: money.revenueImpact,
      codes: batchCoupons.map((row) => row.code),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    });
  }
  return result;
}
