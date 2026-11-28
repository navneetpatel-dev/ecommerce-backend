import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { taxService } from './tax.service';
import {
  CreateTaxRuleSchema,
  DeleteTaxRuleQuerySchema,
  EffectiveRuleQuerySchema,
  TaxRuleImpactSchema,
  TaxRuleListQuerySchema,
  UpdateTaxRuleSchema,
} from './tax.dto';
import { taxRuleMrpImpact } from './mrpImpact';

/**
 * A tax rule change can move the GST on every product below its category, so the
 * GST-inclusive prices customers see are recomputed.
 */
function refreshDisplayPricesAfterRuleChange(): void {
  void import('@modules/products/products.service').then(({ refreshAllProductDisplayPricesInBackground }) =>
    refreshAllProductDisplayPricesInBackground('tax rule change'),
  );
}

export const listRules = asyncHandler(async (req: Request, res: Response) => {
  const query = TaxRuleListQuerySchema.parse(req.query);
  const result = await taxService.getTaxRules(query);
  res.json(ok(result.rules, { pagination: result.pagination }));
});

export const createRule = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateTaxRuleSchema.parse(req.body);
  const rule = await taxService.createTaxRule(dto, req.user!.id);
  refreshDisplayPricesAfterRuleChange();
  res.status(201).json(ok(rule));
});

export const updateRule = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateTaxRuleSchema.parse(req.body);
  const rule = await taxService.updateTaxRule(req.params.id!, dto, req.user!.id);
  refreshDisplayPricesAfterRuleChange();
  res.json(ok(rule));
});

export const deleteRule = asyncHandler(async (req: Request, res: Response) => {
  const { force } = DeleteTaxRuleQuerySchema.parse(req.query);
  await taxService.deleteTaxRule(req.params.id!, req.user!.id, force === 'true');
  refreshDisplayPricesAfterRuleChange();
  res.status(204).send();
});

/** What a rule change would put above its MRP (and so take off sale), before it is saved. */
export const getRuleImpact = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await taxRuleMrpImpact(TaxRuleImpactSchema.parse(req.body))));
});

/** The tax rule a category gets, and where it comes from. */
export const getEffectiveRule = asyncHandler(async (req: Request, res: Response) => {
  const { categoryId } = EffectiveRuleQuerySchema.parse(req.query);
  res.json(ok(await taxService.explainEffectiveTaxRule(categoryId)));
});
