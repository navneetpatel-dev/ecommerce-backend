import { NotFoundError } from '@core/errors/NotFoundError';
import {
  PRODUCT_QUESTION_STATUS,
  PRODUCT_ANSWER_AUTHOR_TYPE,
  type ProductQuestionStatus,
} from '@core/constants/statuses';
import { productQnaRepository } from './productQna.repository';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { ProductAnswer } from '@database/models/productAnswer.model';
import { Product } from '@database/models/product.model';
import { sequelize } from '@database/models';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';

function serializeQuestion(row: ProductQuestion) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    productId: plain.productId,
    question: plain.question,
    status: plain.status,
    createdAt: plain.createdAt,
    customerName: plain.user?.name ?? null,
    productName: plain.product?.name ?? null,
    answers: (plain.answers ?? []).map((a: any) => ({
      id: a.id,
      answer: a.answer,
      authorType: a.authorType,
      authorName: a.author?.name ?? null,
      createdAt: a.createdAt,
    })),
  };
}

export class ProductQnaService {
  /**
   * Pre-moderation, same policy as reviews: new questions start PENDING and
   * only become customer-visible once a moderator publishes them (see
   * `getProductQuestions`, which only ever returns PUBLISHED rows).
   */
  async askQuestion(userId: string, data: { productId: string; question: string }) {
    const product = await Product.findByPk(data.productId);
    if (!product) throw new NotFoundError('Product');

    return ProductQuestion.create({
      productId: data.productId,
      userId,
      question: data.question,
      status: PRODUCT_QUESTION_STATUS.PENDING,
    });
  }

  /** Public PDP Q&A — PUBLISHED only. */
  async getProductQuestions(productId: string, query: { page: number; limit: number }) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await productQnaRepository.findPublishedForProduct(productId, query.limit, offset);
    return {
      questions: rows.map((row) => serializeQuestion(row)),
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
   * Either the product's owning vendor or any authenticated customer may
   * answer — there is no ownership gate here, only classification: the
   * answering user is tagged VENDOR when their vendorId matches the
   * question's product, otherwise CUSTOMER (same ownership check pattern as
   * `products.service.updateProduct`).
   */
  async answerQuestion(questionId: string, userId: string, vendorId: string | null, answer: string) {
    return sequelize.transaction(async (t) => {
      const question = await ProductQuestion.findByPk(questionId, {
        include: [{ model: Product, as: 'product' }],
        transaction: t,
      });
      if (!question) throw new NotFoundError('ProductQuestion');

      const product = (question as any).product as Product | undefined;
      const authorType =
        vendorId && product?.vendorId === vendorId
          ? PRODUCT_ANSWER_AUTHOR_TYPE.VENDOR
          : PRODUCT_ANSWER_AUTHOR_TYPE.CUSTOMER;

      return ProductAnswer.create(
        {
          questionId,
          authorId: userId,
          authorType,
          answer,
        },
        { transaction: t },
      );
    });
  }

  async moderateQuestion(questionId: string, status: Exclude<ProductQuestionStatus, 'PENDING'>) {
    const question = await ProductQuestion.findByPk(questionId);
    if (!question) throw new NotFoundError('ProductQuestion');
    return question.update({ status });
  }
}

export const productQnaService = new ProductQnaService();
