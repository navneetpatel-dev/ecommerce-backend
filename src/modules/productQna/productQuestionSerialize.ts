import { PRODUCT_ANSWER_STATUS } from '@core/constants/statuses';
import { toPlain } from '@core/repository/toPlain';
import type { ProductQuestion } from '@database/models/productQuestion.model';
import { serializeAnswer, type AnswerRow } from './productAnswerThreads';

type PlainAnswer = {
  id: string;
  answer: string;
  authorId: string;
  authorType: string;
  author?: { name?: string } | null;
  status: string;
  createdAt: Date;
  editedAt?: Date | null;
};

type PlainQuestion = {
  id: string;
  productId: string;
  userId: string;
  question: string;
  status: string;
  createdAt: Date;
  editedAt?: Date | null;
  answers?: PlainAnswer[];
  answerCount?: number | string;
  user?: { name?: string } | null;
  product?: { name?: string } | null;
};

export function serializeQuestion(
  row: ProductQuestion,
  opts?: { publishedAnswersOnly?: boolean; previewAnswers?: AnswerRow[] },
) {
  const plain = toPlain<PlainQuestion>(row);
  const answers = (plain.answers ?? []).filter((answer) =>
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
      : answers.map((a) => ({
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
