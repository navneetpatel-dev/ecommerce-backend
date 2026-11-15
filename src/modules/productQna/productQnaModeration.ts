import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { PRODUCT_ANSWER_STATUS, PRODUCT_QUESTION_STATUS } from '@core/constants/statuses';

/**
 * One moderation queue for Q&A, oldest first: new questions and answers
 * (PENDING) and edits of published ones (`pendingRevision`). For an edit,
 * `text` is the proposed wording and `previousText` what shoppers see now.
 */
export interface QnaModerationItem {
  id: string;
  kind: 'QUESTION' | 'ANSWER';
  submission: 'NEW' | 'EDIT';
  text: string;
  previousText: string | null;
  questionText: string | null;
  productName: string | null;
  authorName: string | null;
  authorType?: 'VENDOR' | 'CUSTOMER';
  vendorName?: string | null;
  submittedAt: string;
}

const QUEUE = `
  SELECT q.id, 'QUESTION' AS kind,
         CASE WHEN q."pendingRevision" IS NULL THEN 'NEW' ELSE 'EDIT' END AS submission,
         COALESCE(q."pendingRevision"->>'question', q.question) AS text,
         CASE WHEN q."pendingRevision" IS NULL THEN NULL ELSE q.question END AS "previousText",
         NULL AS "questionText", p.name AS "productName", u.name AS "authorName",
         'CUSTOMER' AS "authorType", NULL AS "vendorName",
         COALESCE((q."pendingRevision"->>'submittedAt')::timestamptz, q."createdAt") AS "submittedAt"
    FROM product_questions q
    LEFT JOIN products p ON p.id = q."productId"
    LEFT JOIN users u ON u.id = q."userId"
   WHERE q."deletedAt" IS NULL
     AND (q.status = :questionPending OR q."pendingRevision" IS NOT NULL)
  UNION ALL
  SELECT a.id, 'ANSWER',
         CASE WHEN a."pendingRevision" IS NULL THEN 'NEW' ELSE 'EDIT' END,
         COALESCE(a."pendingRevision"->>'answer', a.answer),
         CASE WHEN a."pendingRevision" IS NULL THEN NULL ELSE a.answer END,
         q.question, p.name, u.name,
         a."authorType", v."businessName" AS "vendorName",
         COALESCE((a."pendingRevision"->>'submittedAt')::timestamptz, a."createdAt")
    FROM product_answers a
    JOIN product_questions q ON q.id = a."questionId" AND q."deletedAt" IS NULL
    LEFT JOIN products p ON p.id = q."productId"
    LEFT JOIN users u ON u.id = a."authorId"
    LEFT JOIN vendors v ON v.id = u."vendorId"
   WHERE a."deletedAt" IS NULL
     AND (a.status = :answerPending OR a."pendingRevision" IS NOT NULL)`;

const replacements = {
  questionPending: PRODUCT_QUESTION_STATUS.PENDING,
  answerPending: PRODUCT_ANSWER_STATUS.PENDING,
};

export async function listQnaModerationQueue(limit: number, offset: number) {
  const [items, [countRow]] = await Promise.all([
    sequelize.query<QnaModerationItem>(
      `SELECT * FROM (${QUEUE}) queue ORDER BY "submittedAt" ASC, id ASC LIMIT :limit OFFSET :offset`,
      { replacements: { ...replacements, limit, offset }, type: QueryTypes.SELECT },
    ),
    sequelize.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM (${QUEUE}) queue`, {
      replacements,
      type: QueryTypes.SELECT,
    }),
  ]);
  return { items, count: countRow?.count ?? 0 };
}
