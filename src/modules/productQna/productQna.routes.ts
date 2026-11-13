import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  AskQuestionSchema,
  AnswerQuestionSchema,
  ModerateQuestionSchema,
  UpdateAnswerSchema,
  UpdateQuestionSchema,
} from './productQna.dto';
import * as productQnaController from './productQna.controller';

const router = Router();

router.get('/moderation', authenticate, authorize(PERMISSIONS.REVIEW_MODERATE), productQnaController.listPending);
router.post('/questions', authenticate, validate(AskQuestionSchema), productQnaController.ask);
router.get('/questions/mine', authenticate, productQnaController.getMyQuestions);
router.get('/answers/mine', authenticate, productQnaController.getMyAnswers);
router.get('/questions/vendor/me', authenticate, authorize(PERMISSIONS.REVIEW_RESPOND), productQnaController.getVendorQuestions);
router.get(
  '/products/:productId/questions',
  optionalAuthenticate,
  productQnaController.getByProduct,
);
router.get('/products/:productId/can-answer', authenticate, productQnaController.canAnswer);
router.get('/questions/:id/answers', productQnaController.getAnswers);
router.post('/questions/:id/answers', authenticate, validate(AnswerQuestionSchema), productQnaController.answer);
router.patch('/questions/:id', authenticate, validate(UpdateQuestionSchema), productQnaController.editQuestion);
router.patch('/answers/:answerId', authenticate, validate(UpdateAnswerSchema), productQnaController.editAnswer);
router.delete('/answers/:answerId', authenticate, productQnaController.deleteAnswer);
router.patch(
  '/answers/:answerId/status',
  authenticate,
  authorize(PERMISSIONS.REVIEW_MODERATE),
  validate(ModerateQuestionSchema),
  productQnaController.moderateAnswer,
);
router.patch(
  '/questions/:id/status',
  authenticate,
  authorize(PERMISSIONS.REVIEW_MODERATE),
  validate(ModerateQuestionSchema),
  productQnaController.moderate,
);

export default router;
