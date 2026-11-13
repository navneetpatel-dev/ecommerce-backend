import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { productQnaService } from './productQna.service';
import { canAnswerForProduct } from './buyerCheck';
import { assertNotDuplicateSubmission } from '@core/http/duplicateSubmitGuard';
import {
  AskQuestionSchema,
  AnswerQuestionSchema,
  ModerateQuestionSchema,
  ProductQuestionsQuerySchema,
  UpdateAnswerSchema,
  UpdateQuestionSchema,
} from './productQna.dto';
import { updateOwnAnswer, updateOwnQuestion } from './productQnaEdits';

export const ask = asyncHandler(async (req: Request, res: Response) => {
  const dto = AskQuestionSchema.parse(req.body);
  await assertNotDuplicateSubmission('question', req.user!.id, dto);
  const question = await productQnaService.askQuestion(req.user!.id, dto);
  res.status(201).json(ok(question));
});

export const getByProduct = asyncHandler(async (req: Request, res: Response) => {
  const query = ProductQuestionsQuerySchema.parse(req.query);
  const result = await productQnaService.getProductQuestions(req.params.productId!, query, req.user?.id);
  res.json(ok(result.questions, { pagination: result.pagination, summary: result.summary }));
});

/** Whether the signed-in shopper may answer this product's questions (C-01): the web shows Answer only then. */
export const canAnswer = asyncHandler(async (req: Request, res: Response) => {
  const productId = req.params.productId!;
  res.json(ok({ canAnswer: await canAnswerForProduct(req.user!.id, req.user!.vendorId ?? null, productId) }));
});

export const getVendorQuestions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.vendorId) {
    throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
  }
  const questions = await productQnaService.getVendorQuestions(req.user.vendorId);
  res.json(ok(questions));
});

export const listPending = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await productQnaService.listPending(query);
  res.json(ok(result.questions, { pagination: result.pagination }));
});

export const answer = asyncHandler(async (req: Request, res: Response) => {
  const { answer: answerText } = AnswerQuestionSchema.parse(req.body);
  const created = await productQnaService.answerQuestion(
    req.params.id!,
    req.user!.id,
    req.user!.vendorId,
    answerText,
  );
  res.status(201).json(ok(created));
});

export const moderate = asyncHandler(async (req: Request, res: Response) => {
  const { status } = ModerateQuestionSchema.parse(req.body);
  const question = await productQnaService.moderateQuestion(req.params.id!, status);
  res.json(ok(question));
});

export const deleteAnswer = asyncHandler(async (req: Request, res: Response) => {
  await productQnaService.deleteAnswer(req.params.answerId!, {
    id: req.user!.id,
    roleId: req.user!.roleId,
    role: req.user!.role,
  });
  res.status(204).send();
});

export const moderateAnswer = asyncHandler(async (req: Request, res: Response) => {
  const { status } = ModerateQuestionSchema.parse(req.body);
  const answer = await productQnaService.moderateAnswer(req.params.answerId!, status);
  res.json(ok(answer));
});

/** A published question's answers, a page at a time. */
export const getAnswers = asyncHandler(async (req: Request, res: Response) => {
  const result = await productQnaService.getQuestionAnswers(req.params.id!, pageLimitQuerySchema.parse(req.query));
  res.json(ok(result.answers, { pagination: result.pagination }));
});

export const editQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { question } = UpdateQuestionSchema.parse(req.body);
  res.json(ok(await updateOwnQuestion(req.params.id!, req.user!.id, question)));
});

export const editAnswer = asyncHandler(async (req: Request, res: Response) => {
  const { answer } = UpdateAnswerSchema.parse(req.body);
  res.json(ok(await updateOwnAnswer(req.params.answerId!, req.user!.id, answer)));
});

export const getMyQuestions = asyncHandler(async (req: Request, res: Response) => {
  const result = await productQnaService.getMyQuestions(req.user!.id, pageLimitQuerySchema.parse(req.query));
  res.json(ok(result.questions, { pagination: result.pagination }));
});

export const getMyAnswers = asyncHandler(async (req: Request, res: Response) => {
  const result = await productQnaService.getMyAnswers(req.user!.id, pageLimitQuerySchema.parse(req.query));
  res.json(ok(result.answers, { pagination: result.pagination }));
});
