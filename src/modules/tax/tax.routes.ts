// Tax module - GST calculation and tax rules management
import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { z } from 'zod';
import { validate } from '@middleware/validate.middleware';
import { taxService } from './tax.service';

const CreateTaxRuleSchema = z.object({
  categoryId: z.string().uuid().optional(),
  hsnCode: z.string().optional(),
  gstPercentage: z.number().min(0).max(100),
});

const UpdateTaxRuleSchema = z.object({
  categoryId: z.string().uuid().optional(),
  hsnCode: z.string().optional(),
  gstPercentage: z.number().min(0).max(100).optional(),
});

const router = Router();

router.get('/rules', authenticate, authorize('tax.view'), asyncHandler(async (_req, res) => {
  const rules = await taxService.getTaxRules();
  res.json(ok(rules));
}));

router.post('/rules', authenticate, authorize('tax.create'), validate(CreateTaxRuleSchema), asyncHandler(async (req, res) => {
  const dto = CreateTaxRuleSchema.parse(req.body);
  const rule = await taxService.createTaxRule(dto);
  res.status(201).json(ok(rule));
}));

router.patch('/rules/:id', authenticate, authorize('tax.update'), validate(UpdateTaxRuleSchema), asyncHandler(async (req, res) => {
  const dto = UpdateTaxRuleSchema.parse(req.body);
  const rule = await taxService.updateTaxRule(req.params.id!, dto);
  res.json(ok(rule));
}));

router.delete('/rules/:id', authenticate, authorize('tax.delete'), asyncHandler(async (req, res) => {
  await taxService.deleteTaxRule(req.params.id!);
  res.status(204).send();
}));

export default router;
