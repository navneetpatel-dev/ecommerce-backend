import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { PRODUCT_ANSWER_AUTHOR_TYPE, PRODUCT_ANSWER_STATUS } from '@core/constants/statuses';

export interface AnswerRow {
  id: string;
  questionId: string;
  authorId: string;
  authorType: string;
  authorName: string | null;
  answer: string;
  status: string;
  createdAt: Date;
  editedAt: Date | null;
}

/** Best first: the seller's answer, then buyers oldest-first (the thread reads in order). */
const THREAD_ORDER = `(pa."authorType" = '${PRODUCT_ANSWER_AUTHOR_TYPE.VENDOR}') DESC, pa."createdAt" ASC, pa.id ASC`;

const ANSWER_COLUMNS = `pa.id, pa."questionId", pa."authorId", pa."authorType", u.name AS "authorName",
  pa.answer, pa.status, pa."createdAt", pa."editedAt"`;

/** Up to `perQuestion` published answers for each question, in thread order — one query. */
export async function findPreviewAnswers(questionIds: string[], perQuestion: number): Promise<AnswerRow[]> {
  if (!questionIds.length) return [];
  return sequelize.query<AnswerRow>(
    `SELECT ranked.id, ranked."questionId", ranked."authorId", ranked."authorType", ranked."authorName",
            ranked.answer, ranked.status, ranked."createdAt", ranked."editedAt"
       FROM (
         SELECT pa.*, u.name AS "authorName",
                ROW_NUMBER() OVER (PARTITION BY pa."questionId" ORDER BY ${THREAD_ORDER}) AS rn
           FROM product_answers pa
           LEFT JOIN users u ON u.id = pa."authorId"
          WHERE pa."questionId" IN (:questionIds)
            AND pa.status = :published AND pa."deletedAt" IS NULL
       ) ranked
      WHERE ranked.rn <= :perQuestion
      ORDER BY ranked."questionId", ranked.rn`,
    {
      replacements: { questionIds, perQuestion, published: PRODUCT_ANSWER_STATUS.PUBLISHED },
      type: QueryTypes.SELECT,
    },
  );
}

/** One page of a question's published answers, in thread order, with the total. */
export async function findAnswerPage(questionId: string, limit: number, offset: number) {
  const replacements = { questionId, limit, offset, published: PRODUCT_ANSWER_STATUS.PUBLISHED };
  const where = `pa."questionId" = :questionId AND pa.status = :published AND pa."deletedAt" IS NULL`;
  const [rows, [countRow]] = await Promise.all([
    sequelize.query<AnswerRow>(
      `SELECT ${ANSWER_COLUMNS}
         FROM product_answers pa
         LEFT JOIN users u ON u.id = pa."authorId"
        WHERE ${where}
        ORDER BY ${THREAD_ORDER}
        LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT },
    ),
    sequelize.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM product_answers pa WHERE ${where}`,
      { replacements, type: QueryTypes.SELECT },
    ),
  ]);
  return { rows, count: countRow?.count ?? 0 };
}

export function serializeAnswer(row: AnswerRow) {
  return {
    id: row.id,
    answer: row.answer,
    authorId: row.authorId,
    authorType: row.authorType,
    authorName: row.authorName,
    status: row.status,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
  };
}
