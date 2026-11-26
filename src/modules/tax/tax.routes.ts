import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateTaxRuleSchema, EffectiveRuleQuerySchema, TaxRuleListQuerySchema, UpdateTaxRuleSchema } from './tax.dto';
import * as taxController from './tax.controller';

const router = Router();

router.get('/rules', authenticate, authorize(PERMISSIONS.TAX_MANAGE), validate(TaxRuleListQuerySchema, 'query'), taxController.listRules);
// Which rule a category gets and why: category managers see it too (the category dialog shows it).
router.get('/rules/effective', authenticate, authorize(PERMISSIONS.TAX_MANAGE, PERMISSIONS.CATEGORY_MANAGE), validate(EffectiveRuleQuerySchema, 'query'), taxController.getEffectiveRule);
router.post('/rules', authenticate, authorize(PERMISSIONS.TAX_MANAGE), validate(CreateTaxRuleSchema), taxController.createRule);
router.patch('/rules/:id', authenticate, authorize(PERMISSIONS.TAX_MANAGE), validate(UpdateTaxRuleSchema), taxController.updateRule);
router.delete('/rules/:id', authenticate, authorize(PERMISSIONS.TAX_MANAGE), taxController.deleteRule);

export default router;
