import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { taxService } from './tax.service';
import { CreateTaxRuleSchema, UpdateTaxRuleSchema } from './tax.dto';

export const listRules = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await taxService.getTaxRules(query);
  res.json(ok(result.rules, { pagination: result.pagination }));
});

export const createRule = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateTaxRuleSchema.parse(req.body);
  const rule = await taxService.createTaxRule(dto, req.user!.id);
  res.status(201).json(ok(rule));
});

export const updateRule = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateTaxRuleSchema.parse(req.body);
  const rule = await taxService.updateTaxRule(req.params.id!, dto, req.user!.id);
  res.json(ok(rule));
});

export const deleteRule = asyncHandler(async (req: Request, res: Response) => {
  await taxService.deleteTaxRule(req.params.id!, req.user!.id);
  res.status(204).send();
});
