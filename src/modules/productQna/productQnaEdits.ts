import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errorMessages';
import { PRODUCT_ANSWER_STATUS, PRODUCT_QUESTION_STATUS } from '@core/constants/statuses';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { ProductAnswer } from '@database/models/productAnswer.model';

/**
 * Owner edits. Same pre-moderation as posting: an edit goes back to PENDING so
 * nothing changed reaches the public page unchecked, and `editedAt` marks it.
 */
export async function updateOwnQuestion(questionId: string, userId: string, question: string) {
  const row = await ProductQuestion.findByPk(questionId);
  if (!row) throw new NotFoundError('ProductQuestion');
  if (row.userId !== userId) throw new ForbiddenError(ERROR_MESSAGES.QUESTION_NOT_YOURS);
  // Rewording a question others already answered would change what they answered.
  const answered = await ProductAnswer.count({
    where: { questionId, status: PRODUCT_ANSWER_STATUS.PUBLISHED },
  });
  if (answered > 0) throw new ValidationError({ question: [ERROR_MESSAGES.QUESTION_HAS_ANSWERS] });
  return row.update({ question, status: PRODUCT_QUESTION_STATUS.PENDING, editedAt: new Date(), updatedBy: userId });
}

export async function updateOwnAnswer(answerId: string, userId: string, answer: string) {
  const row = await ProductAnswer.findByPk(answerId);
  if (!row) throw new NotFoundError('ProductAnswer');
  if (row.authorId !== userId) throw new ForbiddenError(ERROR_MESSAGES.ANSWER_NOT_YOURS);
  return row.update({ answer, status: PRODUCT_ANSWER_STATUS.PENDING, editedAt: new Date(), updatedBy: userId });
}
