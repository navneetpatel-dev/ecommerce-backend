import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { productQnaService } from './productQna.service';
import { AskQuestionSchema, AnswerQuestionSchema, ModerateQuestionSchema } from './productQna.dto';

export const ask = asyncHandler(async (req: Request, res: Response) => {
  const dto = AskQuestionSchema.parse(req.body);
  const question = await productQnaService.askQuestion(req.user!.id, dto);
  res.status(201).json(ok(question));
});

export const getByProduct = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await productQnaService.getProductQuestions(req.params.productId!, query);
  res.json(ok(result.questions, { pagination: result.pagination }));
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
