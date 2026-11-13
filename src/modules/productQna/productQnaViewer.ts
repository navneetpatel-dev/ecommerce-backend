import { literal } from 'sequelize';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { ProductAnswer } from '@database/models/productAnswer.model';
import { PRODUCT_ANSWER_STATUS } from '@core/constants/statuses';
import { serializeAnswer, type AnswerRow } from './productAnswerThreads';

/** Published answers on the current question row (same rule as the public count). */
const ANSWER_COUNT = literal(`(SELECT COUNT(*) FROM product_answers pa
  WHERE pa."questionId" = "ProductQuestion"."id"
    AND pa.status = '${PRODUCT_ANSWER_STATUS.PUBLISHED}' AND pa."deletedAt" IS NULL)`);

type ProductLink = { id: string; name: string; slug: string } | null;

interface MyQuestionRow {
  id: string;
  question: string;
  status: string;
  createdAt: Date;
  editedAt: Date | null;
  userId: string;
  answerCount?: string | number;
  product?: ProductLink;
}

interface MyAnswerRow {
  question?: { id: string; question: string; product?: ProductLink } | null;
}

const productLink = (product?: ProductLink): ProductLink =>
  product ? { id: product.id, name: product.name, slug: product.slug } : null;

const PRODUCT_LINK = { association: 'product', attributes: ['id', 'name', 'slug'], paranoid: false };

function toAnswerRow(answer: ProductAnswer): AnswerRow {
  const plain = answer.get({ plain: true }) as unknown as AnswerRow & { author?: { name?: string } };
  return { ...plain, authorName: plain.author?.name ?? null };
}

/**
 * The viewer's own answer on each of these questions, whatever its moderation
 * state, so the page can pin it first and offer "Edit your answer".
 */
export async function findViewerAnswers(questionIds: string[], viewerUserId: string) {
  if (!questionIds.length) return new Map<string, ReturnType<typeof serializeAnswer>>();
  const rows = await ProductAnswer.findAll({
    where: { questionId: questionIds, authorId: viewerUserId },
    include: [{ association: 'author', attributes: ['id', 'name'] }],
  });
  return new Map(rows.map((row) => [row.questionId, serializeAnswer(toAnswerRow(row))]));
}

/** "My questions": everything the shopper asked, newest first, any status. */
export async function findMyQuestions(userId: string, limit: number, offset: number) {
  const { rows, count } = await ProductQuestion.findAndCountAll({
    where: { userId },
    attributes: { include: [[ANSWER_COUNT, 'answerCount']] },
    include: [PRODUCT_LINK],
    order: [['createdAt', 'DESC'], ['id', 'ASC']],
    limit,
    offset,
    distinct: true,
    col: 'id',
  });
  const questions = rows.map((row) => {
    const plain = row.get({ plain: true }) as unknown as MyQuestionRow;
    return {
      id: plain.id,
      question: plain.question,
      status: plain.status,
      createdAt: plain.createdAt,
      editedAt: plain.editedAt ?? null,
      userId: plain.userId,
      answerCount: Number(plain.answerCount ?? 0),
      product: productLink(plain.product),
    };
  });
  return { questions, count };
}

/** "My answers": every answer the shopper wrote, with its question and product. */
export async function findMyAnswers(userId: string, limit: number, offset: number) {
  const { rows, count } = await ProductAnswer.findAndCountAll({
    where: { authorId: userId },
    include: [
      { association: 'author', attributes: ['id', 'name'] },
      {
        association: 'question',
        attributes: ['id', 'question', 'status', 'productId'],
        paranoid: false,
        include: [PRODUCT_LINK],
      },
    ],
    order: [['createdAt', 'DESC'], ['id', 'ASC']],
    limit,
    offset,
    distinct: true,
    col: 'id',
  });
  const answers = rows.map((row) => {
    const plain = row.get({ plain: true }) as unknown as MyAnswerRow;
    return {
      ...serializeAnswer(toAnswerRow(row)),
      question: plain.question
        ? {
            id: plain.question.id,
            question: plain.question.question,
            product: productLink(plain.question.product),
          }
        : null,
    };
  });
  return { answers, count };
}
