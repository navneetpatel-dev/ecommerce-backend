import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { userHasPermission } from '@middleware/rbac.middleware';
import { assertRateChangeAllowed, recordRateChange } from './categoryChangeGate';
import { categoryRateImpact, type CategoryChange } from './categoryRateImpact';
import { reassignBlockers } from './categoryReassign';
import { newlyAboveMrp } from '@modules/tax/mrpImpact';
import { RateImpactQuerySchema } from './categories.dto';

const canPrice = (req: Request) => userHasPermission(req.user, PERMISSIONS.PRODUCT_PRICING);

/**
 * Checks a move or reassignment before it runs. Call `record` after it succeeds: it audits and
 * tells the vendors whose rates changed.
 */
export async function guardRateChange(req: Request, change: CategoryChange, changeReason: unknown) {
  const impact = await categoryRateImpact(change);
  const reason = assertRateChangeAllowed({ id: req.user!.id, canPrice: await canPrice(req) }, impact, changeReason);
  const categoryId = change.kind === 'reassign' ? change.toCategoryId : change.categoryId;
  return {
    impact,
    record: async () => {
      if (reason) await recordRateChange(req.user!.id, categoryId, impact, reason);
    },
  };
}

/** What a move or reassignment would charge differently, shown before the admin confirms. */
export const getRateImpact = asyncHandler(async (req: Request, res: Response) => {
  const query = RateImpactQuerySchema.parse(req.query);
  const change: CategoryChange =
    query.kind === 'reassign'
      ? { kind: 'reassign', fromCategoryId: query.fromCategoryId, toCategoryId: query.toCategoryId }
      : { kind: 'reparent', categoryId: query.categoryId, parentId: query.parentId ?? null };
  const impact = await categoryRateImpact(change);
  // Vendors without the documents for the target stop a reassignment altogether.
  const blockedVendors =
    change.kind === 'reassign' ? await reassignBlockers(change.fromCategoryId, change.toCategoryId) : [];
  // Listings the new category's GST would put above their MRP stop selling.
  const aboveMrp = await newlyAboveMrp(
    change.kind === 'reassign'
      ? { targetOf: (id) => (id === change.fromCategoryId ? change.toCategoryId : id) }
      : {
          after: ({ rules, categories }) => ({
            rules,
            categories: categories.map((node) => (node.id === change.categoryId ? { ...node, parentId: change.parentId } : node)),
          }),
        },
  );
  res.json(ok({ ...impact, blockedVendors, aboveMrp, canApply: impact.productCount === 0 || (await canPrice(req)) }));
});
