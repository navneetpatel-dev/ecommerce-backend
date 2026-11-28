import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { Category } from '@database/models/category.model';
import { userHasPermission } from '@middleware/rbac.middleware';
import { assertRateChangeAllowed, recordRateChange } from './categoryChangeGate';
import { categoryRateImpact, type CategoryChange } from './categoryRateImpact';
import { newlyAboveMrp } from '@modules/tax/mrpImpact';
import { RateImpactQuerySchema } from './categories.dto';

const canPrice = (req: Request) => userHasPermission(req.user, PERMISSIONS.PRODUCT_PRICING);

/**
 * Checks a move or commission change before it runs. Call `record` after it succeeds: it audits and
 * tells the vendors whose rates changed.
 */
export async function guardRateChange(req: Request, change: CategoryChange, changeReason: unknown) {
  const impact = await categoryRateImpact(change);
  const reason = assertRateChangeAllowed({ id: req.user!.id, canPrice: await canPrice(req) }, impact, changeReason);
  const changes = change.kind === 'edit' ? "commission, because their category's rate was changed" : undefined;
  return {
    impact,
    record: async () => {
      if (reason) await recordRateChange(req.user!.id, change.categoryId, impact, reason, changes);
    },
  };
}

/** Commission is what the platform charges vendors, so setting it takes the pricing power. */
export async function assertMaySetCommission(req: Request): Promise<void> {
  if (!(await canPrice(req))) throw new ForbiddenError(ERROR_MESSAGES.CATEGORY_COMMISSION_RESTRICTED);
}

const sameRate = (stored: unknown, sent: number | null) =>
  stored == null || sent == null ? stored == null && sent == null : Number(stored) === sent;

/**
 * The gate for an edit of one category. A different commission rate needs `product.pricing` (plus a
 * reason when live or pending products are charged differently); a new parent is gated as a move.
 * A form re-sending the stored rate is not a change.
 */
export async function guardCategoryEdit(
  req: Request,
  categoryId: string,
  edit: { parentId?: string | null; commissionRate?: number | null },
  changeReason: unknown,
) {
  const { parentId, commissionRate } = edit;
  const stored = commissionRate === undefined ? null : await Category.findByPk(categoryId, { attributes: ['commissionRate'] });
  if (stored && commissionRate !== undefined && !sameRate(stored.commissionRate, commissionRate)) {
    await assertMaySetCommission(req);
    return guardRateChange(req, { kind: 'edit', categoryId, commissionRate, parentId }, changeReason);
  }
  return parentId === undefined ? null : guardRateChange(req, { kind: 'reparent', categoryId, parentId }, changeReason);
}

/** What a move or commission change would charge differently, shown before the admin confirms. */
export const getRateImpact = asyncHandler(async (req: Request, res: Response) => {
  const query = RateImpactQuerySchema.parse(req.query);
  const change: CategoryChange =
    query.kind === 'reparent'
      ? { kind: 'reparent', categoryId: query.categoryId, parentId: query.parentId ?? null }
      : {
          kind: 'edit',
          categoryId: query.categoryId,
          commissionRate: query.commissionRate ?? null,
          parentId: query.parentId === 'none' ? null : query.parentId,
        };
  const impact = await categoryRateImpact(change);
  // Listings the new parent's GST would put above their MRP stop selling.
  const aboveMrp = await newlyAboveMrp({
    after: ({ rules, categories }) => ({
      rules,
      categories: categories.map((node) =>
        node.id === change.categoryId && change.parentId !== undefined ? { ...node, parentId: change.parentId } : node,
      ),
    }),
  });
  // A commission edit needs the pricing power even when no product is affected yet.
  const needsPricing = change.kind === 'edit' || impact.productCount > 0;
  res.json(ok({ ...impact, aboveMrp, canApply: !needsPricing || (await canPrice(req)) }));
});
