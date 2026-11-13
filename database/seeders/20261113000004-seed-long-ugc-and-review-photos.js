'use strict';

const { assertSeedingAllowed } = require('../seedGuard');
const {
  REVIEW_PARAGRAPHS,
  LONG_REVIEW_TITLES,
  LONG_QUESTIONS,
  ANSWER_PARAGRAPHS,
} = require('./lib/long-ugc-content');

/**
 * Test data for "Read more" and review galleries, on top of the existing demo rows:
 * - ~1 in 6 reviews (and every review by the test customers) get 2–5 photos; half
 *   of those also get a long multi-paragraph body, some a long title;
 * - ~1 in 8 questions get a long question; ~1 in 10 shopper answers a long
 *   answer (written as a buyer's experience, so never on a seller's answer).
 * All within the posting limits, so the edit forms accept them.
 *
 * Photos are the product's own images that actually load (each URL is checked;
 * some catalogue images 404). Originals are copied to `seed_ugc_backup` first, so
 * `down` restores every row exactly.
 *
 * Run: npx sequelize-cli db:seed --seed 20261113000004-seed-long-ugc-and-review-photos.js
 */
const SEED_NAME = '20261113000004-seed-long-ugc-and-review-photos.js';
const TEST_CUSTOMERS = ['amit.gupta54@example.com', 'karan.verma70@example.com'];
const H = (col) => `(hashtext(${col}::text)::bigint & 2147483647)`;

async function loadableImageUrls(sequelize) {
  const [rows] = await sequelize.query(
    'SELECT DISTINCT url FROM product_images WHERE "deletedAt" IS NULL',
  );
  const ok = [];
  const queue = rows.map((r) => r.url);
  const worker = async () => {
    while (queue.length) {
      const url = queue.pop();
      try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        if (res.ok) ok.push(url);
      } catch {
        /* unreachable: not used */
      }
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  return ok;
}

const pgArray = (items) => `{${items.map((t) => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed(SEED_NAME);
    const { sequelize } = queryInterface;
    const [[exists]] = await sequelize.query(`SELECT to_regclass('public.seed_ugc_backup') AS t`);
    if (exists.t) {
      console.log('✓ Long-text / review-photo seed already applied — skipped');
      return;
    }
    const okUrls = await loadableImageUrls(sequelize);
    if (!okUrls.length) throw new Error('No product image URL could be reached; aborting');

    await sequelize.transaction(async (transaction) => {
      const q = (sql, replacements = {}) => sequelize.query(sql, { replacements, transaction });
      await q(`CREATE TABLE seed_ugc_backup (
                 table_name text NOT NULL, row_id uuid NOT NULL, data jsonb NOT NULL,
                 PRIMARY KEY (table_name, row_id))`);

      // ---- Reviews: photos (+ long text for half) ---------------------------
      await q(
        `CREATE TEMP TABLE review_targets ON COMMIT DROP AS
           SELECT r.id, r."productId", ${H('r.id')} AS h
             FROM reviews r
            WHERE r."deletedAt" IS NULL
              AND (${H('r.id')} % 6 = 0
                   OR r."userId" IN (SELECT id FROM users WHERE email IN (:testCustomers)))`,
        { testCustomers: TEST_CUSTOMERS },
      );
      await q(`INSERT INTO seed_ugc_backup
                 SELECT 'reviews', r.id, jsonb_build_object('title', r.title, 'body', r.body, 'media', r.media)
                   FROM reviews r JOIN review_targets t ON t.id = r.id`);
      await q(
        `UPDATE reviews r SET
           media = (
             SELECT COALESCE(jsonb_agg(jsonb_build_object('url', pick.url, 'type', 'IMAGE', 'durationSeconds', NULL)), '[]'::jsonb)
               FROM (
                 SELECT c.url FROM (
                   SELECT DISTINCT pi.url FROM product_images pi
                    WHERE pi."productId" = t."productId" AND pi."deletedAt" IS NULL
                      AND pi.url = ANY(CAST(:okUrls AS text[]))
                   UNION
                   -- Too few working images for this product: borrow from the pool.
                   SELECT u FROM unnest(CAST(:okUrls AS text[])) AS u
                    WHERE (SELECT COUNT(DISTINCT pi2.url) FROM product_images pi2
                            WHERE pi2."productId" = t."productId" AND pi2.url = ANY(CAST(:okUrls AS text[]))) < 2
                 ) c
                 ORDER BY md5(c.url || t.id::text)
                 LIMIT 2 + (t.h % 4)
               ) pick),
           body = CASE WHEN t.h % 2 = 0 THEN LEFT(array_to_string(ARRAY(
                    SELECT p FROM unnest(CAST(:paras AS text[])) AS p
                     ORDER BY md5(p || t.id::text) LIMIT 4 + (t.h % 3)), E'\\n\\n'), 2000)
                  ELSE r.body END,
           title = CASE WHEN t.h % 3 = 0
                    THEN (CAST(:titles AS text[]))[1 + (t.h % :titleCount)]
                    ELSE r.title END
         FROM review_targets t
        WHERE r.id = t.id`,
        {
          okUrls: pgArray(okUrls),
          paras: pgArray(REVIEW_PARAGRAPHS),
          titles: pgArray(LONG_REVIEW_TITLES),
          titleCount: LONG_REVIEW_TITLES.length,
        },
      );

      // ---- Questions: long text ---------------------------------------------
      await q(`INSERT INTO seed_ugc_backup
                 SELECT 'product_questions', id, jsonb_build_object('question', question)
                   FROM product_questions WHERE "deletedAt" IS NULL AND ${H('id')} % 8 = 0`);
      await q(
        `UPDATE product_questions SET question = (CAST(:questions AS text[]))[1 + (${H('id')} % :count)]
          WHERE "deletedAt" IS NULL AND ${H('id')} % 8 = 0`,
        { questions: pgArray(LONG_QUESTIONS), count: LONG_QUESTIONS.length },
      );

      // ---- Answers: long text -------------------------------------------------
      await q(`INSERT INTO seed_ugc_backup
                 SELECT 'product_answers', id, jsonb_build_object('answer', answer)
                   FROM product_answers
                  WHERE "deletedAt" IS NULL AND "authorType" = 'CUSTOMER' AND ${H('id')} % 10 = 0`);
      await q(
        `UPDATE product_answers SET answer = LEFT(array_to_string(ARRAY(
            SELECT p FROM unnest(CAST(:paras AS text[])) WITH ORDINALITY AS x(p, n)
             WHERE n = 1 OR md5(p || product_answers.id::text) < '9'
             ORDER BY n), E'\\n\\n'), 1000)
          WHERE "deletedAt" IS NULL AND "authorType" = 'CUSTOMER' AND ${H('id')} % 10 = 0`,
        { paras: pgArray(ANSWER_PARAGRAPHS) },
      );
    });

    const [[counts]] = await sequelize.query(
      `SELECT COUNT(*) FILTER (WHERE table_name = 'reviews') AS reviews,
              COUNT(*) FILTER (WHERE table_name = 'product_questions') AS questions,
              COUNT(*) FILTER (WHERE table_name = 'product_answers') AS answers
         FROM seed_ugc_backup`,
    );
    console.log(
      `✓ Long text / photos: ${counts.reviews} reviews, ${counts.questions} questions, ${counts.answers} answers ` +
        `(${okUrls.length} working image URLs)`,
    );
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;
    const [[exists]] = await sequelize.query(`SELECT to_regclass('public.seed_ugc_backup') AS t`);
    if (!exists.t) return;
    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });
      await q(`UPDATE reviews r SET title = b.data->>'title', body = b.data->>'body', media = b.data->'media'
                 FROM seed_ugc_backup b WHERE b.table_name = 'reviews' AND b.row_id = r.id`);
      await q(`UPDATE product_questions x SET question = b.data->>'question'
                 FROM seed_ugc_backup b WHERE b.table_name = 'product_questions' AND b.row_id = x.id`);
      await q(`UPDATE product_answers x SET answer = b.data->>'answer'
                 FROM seed_ugc_backup b WHERE b.table_name = 'product_answers' AND b.row_id = x.id`);
      await q('DROP TABLE seed_ugc_backup');
    });
  },
};
