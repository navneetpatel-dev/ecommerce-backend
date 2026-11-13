'use strict';

const { assertSeedingAllowed } = require('../seedGuard');

/**
 * Long answer threads for exercising "See N more answers" / "Load more answers":
 * every published question gets 50–70 more published answers, each from a
 * different shopper who actually received the product (the C-01 answer rule),
 * never the asker; one answer per person per question is a unique index, so
 * repeats are skipped. Generated in one server-side statement — this is
 * ~3M rows; inserting them from Node would take far longer.
 *
 * Every row has createdBy = SEED_MARKER: re-running is a no-op and `down` removes
 * exactly this seed.
 *
 * Run: npx sequelize-cli db:seed --seed 20261113000003-seed-answer-threads.js
 */
const SEED_NAME = '20261113000003-seed-answer-threads.js';
const SEED_MARKER = '5eed0000-0000-4000-8000-00000000a11b';
const MIN_EXTRA = 50;
const SPREAD = 21; // 50..70 per question

const ANSWERS = [
  'Bought this last month and it has held up really well.',
  'Yes, works exactly as described in the listing.',
  'In my experience it is good value for the price.',
  'I would say yes, but check the size chart before ordering.',
  'Mine arrived in two days and was well packed.',
  'Quality is decent. Not premium, but solid for daily use.',
  'Took it on a trip and had no issues at all.',
  'The colour is a little lighter than the photos.',
  'I have used it every day for weeks, still like new.',
  'Customer support helped me quickly when I had a question.',
  'Yes. My family uses it too and they are happy with it.',
  'It is lighter than I expected, which I liked.',
  'Easy to clean, a damp cloth is enough.',
  'Fits well, I went with my usual size.',
  'Would buy again. No complaints so far.',
  'It is okay. Does the job, nothing fancy.',
  'The finish is good and it feels sturdy.',
  'Warranty card was in the box with the invoice.',
  'Returned my first one for a size swap, exchange was easy.',
  'Great for gifting, the packaging looks nice.',
  'Took a week to my city during the sale, normally faster.',
  'Comfortable for long use in my experience.',
  'The instructions were simple, set up in minutes.',
  'Compared with two others and picked this one, happy with it.',
  'Not waterproof as far as I can tell, so be careful.',
  'Material feels thicker than the cheaper options.',
  'My second purchase from this seller, both were fine.',
  'Arrived exactly as pictured.',
  'Good for beginners, maybe basic for experienced users.',
  'Yes, genuine product with a tax invoice.',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed(SEED_NAME);
    const { sequelize } = queryInterface;
    const [[{ count }]] = await sequelize.query(
      'SELECT COUNT(*)::int AS count FROM product_answers WHERE "createdBy" = :marker',
      { replacements: { marker: SEED_MARKER } },
    );
    if (count > 0) {
      console.log('✓ Answer-thread seed already present — skipped');
      return;
    }

    const [, meta] = await sequelize.query(
      `WITH buyers AS (
         -- Only shoppers who actually received the product may answer (C-01),
         -- so the "Verified buyer" label on these answers is true.
         SELECT pv."productId", array_agg(DISTINCT o."userId") AS ids
           FROM order_items oi
           JOIN sub_orders so ON so.id = oi."subOrderId" AND so.status IN ('DELIVERED', 'RETURNED')
           JOIN orders o ON o.id = so."orderId"
           JOIN product_variants pv ON pv.id = oi."variantId"
          WHERE oi."deletedAt" IS NULL AND so."deletedAt" IS NULL AND o."deletedAt" IS NULL
          GROUP BY pv."productId"
       ),
       q AS (
         SELECT pq.id, pq."userId", pq."createdAt", b.ids, cardinality(b.ids) AS n,
                (hashtext(pq.id::text)::bigint & 2147483647) AS h
           FROM product_questions pq
           JOIN buyers b ON b."productId" = pq."productId"
          WHERE pq.status = 'PUBLISHED' AND pq."deletedAt" IS NULL
       ),
       picks AS (
         -- Consecutive slots modulo n: distinct buyers per question.
         SELECT q.id AS "questionId", q."userId" AS asker, q."createdAt", q.h, k,
                q.ids[1 + ((q.h + k) % q.n)] AS author
           FROM q
           CROSS JOIN LATERAL generate_series(1, LEAST(q.n, :minExtra + (q.h % :spread)::int)) AS k
       )
       INSERT INTO product_answers
         (id, "questionId", "authorId", "authorType", answer, status, "createdBy", "createdAt", "updatedAt")
       SELECT gen_random_uuid(), p."questionId", p.author, 'CUSTOMER',
              ((:answers)::text[])[1 + ((p.h + p.k * 13) % :answerCount)],
              'PUBLISHED', :marker,
              LEAST(p."createdAt" + make_interval(hours => p.k * 5), now() - interval '1 minute'),
              LEAST(p."createdAt" + make_interval(hours => p.k * 5), now() - interval '1 minute')
         FROM picks p
        WHERE p.author <> p.asker -- nobody answers their own question
       ON CONFLICT ("questionId", "authorId") WHERE "deletedAt" IS NULL DO NOTHING`,
      {
        replacements: {
          marker: SEED_MARKER,
          answers: `{${ANSWERS.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(',')}}`,
          answerCount: ANSWERS.length,
          minExtra: MIN_EXTRA,
          spread: SPREAD,
        },
      },
    );
    console.log(`✓ Seeded ${meta?.rowCount ?? 'many'} extra answers across every published question`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM product_answers WHERE "createdBy" = :marker', {
      replacements: { marker: SEED_MARKER },
    });
  },
};
