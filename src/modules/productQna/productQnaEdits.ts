import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errorMessages';
import { PRODUCT_ANSWER_STATUS } from '@core/constants/statuses';
import { answerEditUpdate, questionEditUpdate } from './productQnaRevisions';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { ProductAnswer } from '@database/models/productAnswer.model';
import { sequelize } from '@database/models';

/**
 * Owner edits. Nothing changed reaches the public page unchecked: an edit of
 * published text waits as a revision (the published text stays up); anything
 * not published yet is edited in place and goes back to PENDING. See productQnaRevisions.
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
  return row.update(questionEditUpdate(row, question, userId));
}

export async function updateOwnAnswer(answerId: string, userId: string, answer: string) {
  const row = await ProductAnswer.findByPk(answerId);
  if (!row) throw new NotFoundError('ProductAnswer');
  if (row.authorId !== userId) throw new ForbiddenError(ERROR_MESSAGES.ANSWER_NOT_YOURS);
  return row.update(answerEditUpdate(row, answer, userId));
}

/** The asker deletes their question; its answers go with it (both soft-deleted). */
export async function deleteOwnQuestion(questionId: string, userId: string) {
  const row = await ProductQuestion.findByPk(questionId);
  if (!row) throw new NotFoundError('ProductQuestion');
  if (row.userId !== userId) throw new ForbiddenError(ERROR_MESSAGES.QUESTION_NOT_YOURS);
  await sequelize.transaction(async (transaction) => {
    await ProductAnswer.destroy({ where: { questionId }, transaction });
    await row.destroy({ transaction });
  });
}
