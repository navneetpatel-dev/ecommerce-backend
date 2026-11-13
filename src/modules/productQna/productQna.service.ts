import { UniqueConstraintError } from 'sequelize';
import { NotFoundError } from '@core/errors/NotFoundError';
import { assertBuyerMayAnswer } from './buyerCheck';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import {
  PRODUCT_QUESTION_STATUS,
  PRODUCT_ANSWER_AUTHOR_TYPE,
  PRODUCT_ANSWER_STATUS,
  type ProductQuestionStatus,
  type ProductAnswerStatus,
} from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { userHasPermission } from '@middleware/rbac.middleware';
import { productQnaRepository } from './productQna.repository';
import { serializeAnswer, type AnswerRow } from './productAnswerThreads';
import { findMyAnswers, findMyQuestions, findViewerAnswers } from './productQnaViewer';

/** Answers shown under each question in the list; the rest load on demand. */
const ANSWER_PREVIEW_PER_QUESTION = 1;
import type { ProductQuestionsQuery } from './productQna.dto';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { ProductAnswer } from '@database/models/productAnswer.model';
import { Product } from '@database/models/product.model';
import { sequelize } from '@database/models';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

function serializeQuestion(
  row: ProductQuestion,
  opts?: { publishedAnswersOnly?: boolean; previewAnswers?: AnswerRow[] },
) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  const answers = ((plain.answers ?? []) as Array<Record<string, unknown>>).filter((answer) =>
    opts?.publishedAnswersOnly ? answer.status === PRODUCT_ANSWER_STATUS.PUBLISHED : true,
  );
  return {
    id: plain.id,
    productId: plain.productId,
    userId: plain.userId,
    question: plain.question,
    status: plain.status,
    createdAt: plain.createdAt,
    editedAt: plain.editedAt ?? null,
    customerName: plain.user?.name ?? null,
    productName: plain.product?.name ?? null,
    // Public list: only the best answer(s) ride along; the thread pages in separately.
    answerCount: plain.answerCount !== undefined ? Number(plain.answerCount) : answers.length,
    answers: opts?.previewAnswers
      ? opts.previewAnswers.map(serializeAnswer)
      : answers.map((a: any) => ({
          id: a.id,
          answer: a.answer,
          authorId: a.authorId,
          authorType: a.authorType,
          authorName: a.author?.name ?? null,
          status: a.status,
          createdAt: a.createdAt,
          editedAt: a.editedAt ?? null,
        })),
  };
}

export class ProductQnaService {
  /**
   * Pre-moderation, same policy as reviews: new questions start PENDING and
   * only become public once a moderator publishes them. The asker still sees
   * their own pending question on the product page.
   */
  async askQuestion(userId: string, data: { productId: string; question: string }) {
    // Only products shoppers can see take questions (not drafts, pending or archived).
    const product = await Product.scope('customerVisible').findByPk(data.productId);
    if (!product) throw new NotFoundError('Product');

    return ProductQuestion.create({
      productId: data.productId,
      userId,
      question: data.question,
      status: PRODUCT_QUESTION_STATUS.PENDING,
    });
  }

  /** Public PDP Q&A — PUBLISHED questions and PUBLISHED answers only. */
  async getProductQuestions(productId: string, query: ProductQuestionsQuery, viewerUserId?: string) {
    const offset = paginationOffset(query.page, query.limit);
    const [{ rows, count }, summary] = await Promise.all([
      productQnaRepository.findPublishedForProduct(productId, query, query.limit, offset, viewerUserId),
      productQnaRepository.summarizePublishedForProduct(productId),
    ]);
    const previews = await productQnaRepository.findPreviewAnswers(
      rows.map((row) => row.id),
      ANSWER_PREVIEW_PER_QUESTION,
    );
    const mine = viewerUserId
      ? await findViewerAnswers(rows.map((row) => row.id), viewerUserId)
      : new Map<string, ReturnType<typeof serializeAnswer>>();
    const byQuestion = new Map<string, AnswerRow[]>();
    for (const answer of previews) {
      byQuestion.set(answer.questionId, [...(byQuestion.get(answer.questionId) ?? []), answer]);
    }
    return {
      questions: rows.map((row) => ({
        ...serializeQuestion(row, { previewAnswers: byQuestion.get(row.id) ?? [] }),
        // The viewer's own answer (any status): pinned first, and "Edit your answer".
        myAnswer: mine.get(row.id) ?? null,
      })),
      pagination: buildPaginationMeta(count, query.page, query.limit),
      summary,
    };
  }

  /** "My questions" page. */
  async getMyQuestions(userId: string, query: { page: number; limit: number }) {
    const { questions, count } = await findMyQuestions(userId, query.limit, paginationOffset(query.page, query.limit));
    return { questions, pagination: buildPaginationMeta(count, query.page, query.limit) };
  }

  /** "My answers" page. */
  async getMyAnswers(userId: string, query: { page: number; limit: number }) {
    const { answers, count } = await findMyAnswers(userId, query.limit, paginationOffset(query.page, query.limit));
    return { answers, pagination: buildPaginationMeta(count, query.page, query.limit) };
  }

  /** A published question's answers, a page at a time (threads can be very long). */
  async getQuestionAnswers(questionId: string, query: { page: number; limit: number }) {
    const question = await ProductQuestion.findByPk(questionId, { attributes: ['id', 'status'] });
    if (!question || question.status !== PRODUCT_QUESTION_STATUS.PUBLISHED) {
      throw new NotFoundError('ProductQuestion');
    }
    const { rows, count } = await productQnaRepository.findAnswerPage(
      questionId,
      query.limit,
      paginationOffset(query.page, query.limit),
    );
    return {
      answers: rows.map(serializeAnswer),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  /** Vendor dashboard — questions for products owned by this vendor. */
  async getVendorQuestions(vendorId: string) {
    const rows = await productQnaRepository.findForVendor(vendorId);
    return rows.map((row) => serializeQuestion(row));
  }

  /** Moderation queue. */
  async listPending(query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await productQnaRepository.findPending(query.limit, offset);
    return {
      questions: rows.map((row) => serializeQuestion(row)),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  /**
   * The product's own vendor answers as VENDOR. Anyone else answers as CUSTOMER,
   * and only once that product has been delivered to them (C-01).
   */
  async answerQuestion(questionId: string, userId: string, vendorId: string | null, answer: string) {
    return sequelize.transaction(async (t) => {
      const question = await ProductQuestion.findByPk(questionId, {
        include: [{ model: Product, as: 'product' }],
        transaction: t,
      });
      if (!question) throw new NotFoundError('ProductQuestion');
      if (question.status !== PRODUCT_QUESTION_STATUS.PUBLISHED) {
        throw new ValidationError({
          status: ['Only published questions can be answered'],
        });
      }

      const product = (question as any).product as Product | undefined;
      const authorType =
        vendorId && product?.vendorId === vendorId
          ? PRODUCT_ANSWER_AUTHOR_TYPE.VENDOR
          : PRODUCT_ANSWER_AUTHOR_TYPE.CUSTOMER;
      if (authorType === PRODUCT_ANSWER_AUTHOR_TYPE.CUSTOMER) {
        if (question.userId === userId) {
          throw new ValidationError({ answer: [ERROR_MESSAGES.ANSWER_OWN_QUESTION] });
        }
        await assertBuyerMayAnswer(userId, question.productId, t);
      }

      // One answer per person per question; a second one is an edit of the first.
      const already = await ProductAnswer.count({ where: { questionId, authorId: userId }, transaction: t });
      if (already > 0) throw new ValidationError({ answer: [ERROR_MESSAGES.ANSWER_ALREADY_EXISTS] });

      return ProductAnswer.create(
        {
          questionId,
          authorId: userId,
          authorType,
          answer,
          status: PRODUCT_ANSWER_STATUS.PENDING,
        },
        { transaction: t },
      ).catch((error: unknown) => {
        // Two quick submits: the unique index (live rows) holds the rule.
        if (error instanceof UniqueConstraintError) {
          throw new ValidationError({ answer: [ERROR_MESSAGES.ANSWER_ALREADY_EXISTS] });
        }
        throw error;
      });
    });
  }

  async moderateQuestion(questionId: string, status: Exclude<ProductQuestionStatus, 'PENDING'>) {
    const question = await ProductQuestion.findByPk(questionId);
    if (!question) throw new NotFoundError('ProductQuestion');
    return question.update({ status });
  }

  async deleteAnswer(
    answerId: string,
    actor: { id: string; roleId?: string; role: { name: string } },
  ) {
    const answer = await ProductAnswer.findByPk(answerId);
    if (!answer) throw new NotFoundError('ProductAnswer');
    const isAuthor = answer.authorId === actor.id;
    const isModerator = await userHasPermission(actor, PERMISSIONS.REVIEW_MODERATE);
    if (!isAuthor && !isModerator) {
      throw new ForbiddenError(ERROR_MESSAGES.FORBIDDEN);
    }
    await answer.destroy();
  }

  async moderateAnswer(answerId: string, status: Exclude<ProductAnswerStatus, 'PENDING'>) {
    const answer = await ProductAnswer.findByPk(answerId);
    if (!answer) throw new NotFoundError('ProductAnswer');
    return answer.update({ status });
  }
}

export const productQnaService = new ProductQnaService();
