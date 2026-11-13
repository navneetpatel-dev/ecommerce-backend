import { Op, literal, type OrderItem, type WhereOptions } from 'sequelize';
import type { ProductQuestionsQuery } from './productQna.dto';
import { findAnswerPage, findPreviewAnswers } from './productAnswerThreads';
import { sequelize } from '@database/models';
import { BaseRepository } from '@core/repository/BaseRepository';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { PRODUCT_ANSWER_STATUS, PRODUCT_QUESTION_STATUS } from '@core/constants/statuses';

/** Published answers on the current question row (correlated on the query's model alias). */
const PUBLISHED_ANSWER_COUNT = `(SELECT COUNT(*) FROM product_answers pa
  WHERE pa."questionId" = "ProductQuestion"."id"
    AND pa.status = '${PRODUCT_ANSWER_STATUS.PUBLISHED}'
    AND pa."deletedAt" IS NULL)`;

const QUESTION_SORT_ORDER: Record<ProductQuestionsQuery['sort'], OrderItem[]> = {
  recent: [['createdAt', 'DESC'], ['id', 'ASC']],
  oldest: [['createdAt', 'ASC'], ['id', 'ASC']],
  most_answered: [[literal(PUBLISHED_ANSWER_COUNT), 'DESC'], ['createdAt', 'DESC'], ['id', 'ASC']],
};

/** `%` and `_` in shopper search text are literal characters, not wildcards. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export class ProductQnaRepository extends BaseRepository<ProductQuestion> {
  constructor() {
    super(ProductQuestion);
  }

  /**
   * Public PDP Q&A — PUBLISHED (plus the viewer's own pending) questions,
   * answers nested oldest-first. Filtered by text / answered state and sorted.
   */
  async findPublishedForProduct(
    productId: string,
    filters: Pick<ProductQuestionsQuery, 'q' | 'answered' | 'sort'>,
    limit: number,
    offset: number,
    viewerUserId?: string,
  ) {
    const conditions: WhereOptions[] = [
      { productId },
      {
        [Op.or]: [
          { status: PRODUCT_QUESTION_STATUS.PUBLISHED },
          ...(viewerUserId
            ? [{ status: PRODUCT_QUESTION_STATUS.PENDING, userId: viewerUserId }]
            : []),
        ],
      },
    ];
    if (filters.q) conditions.push({ question: { [Op.iLike]: `%${escapeLike(filters.q)}%` } });
    if (filters.answered === 'answered') conditions.push(literal(`${PUBLISHED_ANSWER_COUNT} > 0`));
    if (filters.answered === 'unanswered') conditions.push(literal(`${PUBLISHED_ANSWER_COUNT} = 0`));

    return this.model.findAndCountAll({
      where: { [Op.and]: conditions },
      // A thread can run to thousands of answers: carry the count, never the rows.
      // The best answer per question comes from `findPreviewAnswers`, the rest a page at a time.
      attributes: { include: [[literal(PUBLISHED_ANSWER_COUNT), 'answerCount']] },
      include: [{ association: 'user', attributes: ['id', 'name'] }],
      // The viewer's own questions first, then the chosen order.
      order: viewerUserId
        ? [
            [literal(`("ProductQuestion"."userId" = ${sequelize.escape(viewerUserId)})`), 'DESC'],
            ...QUESTION_SORT_ORDER[filters.sort],
          ]
        : QUESTION_SORT_ORDER[filters.sort],
      limit,
      offset,
      distinct: true,
      col: 'id',
    });
  }

  /** Best published answer(s) per question, one query (see productAnswerThreads). */
  findPreviewAnswers(questionIds: string[], perQuestion: number) {
    return findPreviewAnswers(questionIds, perQuestion);
  }

  /** One page of a question's published answers. */
  findAnswerPage(questionId: string, limit: number, offset: number) {
    return findAnswerPage(questionId, limit, offset);
  }

  /** "120 questions · 98 answered" for the PDP header — over every published question. */
  async summarizePublishedForProduct(productId: string) {
    const where = { productId, status: PRODUCT_QUESTION_STATUS.PUBLISHED };
    const [total, answered] = await Promise.all([
      this.model.count({ where }),
      this.model.count({ where: { [Op.and]: [where, literal(`${PUBLISHED_ANSWER_COUNT} > 0`)] } }),
    ]);
    return { total, answered };
  }

  async findPending(limit: number, offset: number) {
    return this.model.findAndCountAll({
      where: { status: PRODUCT_QUESTION_STATUS.PENDING },
      include: [
        { association: 'product', attributes: ['id', 'name'] },
        { association: 'user', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'ASC']],
      limit,
      offset,
      distinct: true,
      col: 'id',
    });
  }

  /** Vendor dashboard — questions for products owned by this vendor. */
  async findForVendor(vendorId: string) {
    return this.model.findAll({
      include: [
        { association: 'user', attributes: ['id', 'name'] },
        {
          association: 'product',
          required: true,
          where: { vendorId },
          attributes: ['id', 'name', 'slug'],
        },
        {
          association: 'answers',
          separate: true,
          order: [['createdAt', 'ASC']],
          include: [{ association: 'author', attributes: ['id', 'name'] }],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  }
}

export const productQnaRepository = new ProductQnaRepository();
