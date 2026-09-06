import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { AskQuestionSchema, AnswerQuestionSchema, ModerateQuestionSchema } from './productQna.dto';
import * as productQnaController from './productQna.controller';

const router = Router();

router.get('/moderation', authenticate, authorize(PERMISSIONS.REVIEW_MODERATE), productQnaController.listPending);
router.post('/questions', authenticate, validate(AskQuestionSchema), productQnaController.ask);
router.get('/products/:productId/questions', productQnaController.getByProduct);
router.post('/questions/:id/answers', authenticate, validate(AnswerQuestionSchema), productQnaController.answer);
router.patch(
  '/questions/:id/status',
  authenticate,
  authorize(PERMISSIONS.REVIEW_MODERATE),
  validate(ModerateQuestionSchema),
  productQnaController.moderate,
);

export default router;
