'use strict';

const { randomUUID } = require('node:crypto');
const { assertSeedingAllowed } = require('../seedGuard');
const { createRng, hashString, pick, between, buildReview, buildQuestion } = require('./lib/review-qna-content');

/**
 * Demo volume for the PDP review + Q&A screens: every live product gets
 * REVIEWS_PER_PRODUCT approved reviews (each from a different customer) and
 * QUESTIONS_PER_PRODUCT published questions, most of them answered by the
 * seller and/or other buyers.
 *
 * A review must point at a delivered order line it was written for, so each
 * reviewer gets a backdated DELIVERED order per vendor holding the lines they
 * review. Those orders carry no shipment row (so payouts never pick them up)
 * and are dated weeks back (so delivery/review-request notifications don't fire).
 *
 * Every row written here has createdBy = SEED_MARKER: re-running is a no-op,
 * and `down` removes exactly this seed and nothing else.
 *
 * Run: npx sequelize-cli db:seed --seed 20261113000001-seed-product-reviews-qna.js
 * then `npm run seed:orders:money` (as `db:reset` does) so the backing orders get
 * their GST money and invoice numbers instead of rendering as ₹0 lines.
 */
const SEED_NAME = '20261113000001-seed-product-reviews-qna.js';
const SEED_MARKER = '5eed0000-0000-4000-8000-00000000a11a';
const REVIEWS_PER_PRODUCT = 100;
const QUESTIONS_PER_PRODUCT = 100;
const CHUNK = 1000;
const DAY_MS = 86_400_000;

async function insertChunked(queryInterface, table, rows, transaction) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await queryInterface.bulkInsert(table, rows.slice(i, i + CHUNK), { transaction });
  }
}

function shuffled(list, rng) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function loadInputs(sequelize) {
  const { QueryTypes } = sequelize;
  const products = await sequelize.query(
    `SELECT p.id, p.name, p."vendorId", p."categoryId", v.id AS "variantId", v.price,
            img.url AS "imageUrl", vu.id AS "vendorUserId"
       FROM products p
       JOIN LATERAL (SELECT id, price FROM product_variants
                      WHERE "productId" = p.id AND "deletedAt" IS NULL
                      ORDER BY "createdAt", id LIMIT 1) v ON TRUE
       LEFT JOIN LATERAL (SELECT url FROM product_images
                           WHERE "productId" = p.id AND "deletedAt" IS NULL
                           ORDER BY "isPrimary" DESC, "createdAt" LIMIT 1) img ON TRUE
       LEFT JOIN LATERAL (SELECT id FROM users
                           WHERE "vendorId" = p."vendorId" AND "deletedAt" IS NULL
                           ORDER BY "createdAt" LIMIT 1) vu ON TRUE
      WHERE p."deletedAt" IS NULL
      ORDER BY p."createdAt", p.id`,
    { type: QueryTypes.SELECT },
  );
  const customers = await sequelize.query(
    `SELECT u.id, a.id AS "addressId"
       FROM users u
       JOIN roles r ON r.id = u."roleId" AND r.name = 'CUSTOMER'
       JOIN LATERAL (SELECT id FROM addresses
                      WHERE "userId" = u.id AND "deletedAt" IS NULL
                      ORDER BY "createdAt" LIMIT 1) a ON TRUE
      WHERE u."deletedAt" IS NULL
      ORDER BY u."createdAt", u.id`,
    { type: QueryTypes.SELECT },
  );
  return { products, customers };
}

/** Reviews + the delivered orders behind them. */
function planReviews(products, customers, now) {
  const groups = new Map();
  const reviews = [];
  const buyersByProduct = new Map();
  const perProduct = Math.min(REVIEWS_PER_PRODUCT, customers.length);

  for (const product of products) {
    const rng = createRng(hashString(`${product.id}:reviews`));
    const buyers = shuffled(customers, rng).slice(0, perProduct);
    buyersByProduct.set(product.id, buyers);
    const pricePaise = Math.round(Number(product.price) * 100);

    for (const buyer of buyers) {
      const key = `${buyer.id}|${product.vendorId}`;
      if (!groups.has(key)) {
        groups.set(key, {
          orderId: randomUUID(),
          subOrderId: randomUUID(),
          userId: buyer.id,
          addressId: buyer.addressId,
          vendorId: product.vendorId,
          date: new Date(now - between(rng, 30, 420) * DAY_MS),
          items: [],
        });
      }
      const group = groups.get(key);
      const orderItemId = randomUUID();
      group.items.push({ id: orderItemId, product, pricePaise });

      const content = buildReview(rng, product.name);
      const reviewedAt = new Date(
        Math.min(group.date.getTime() + between(rng, 3, 25) * DAY_MS, now - DAY_MS),
      );
      reviews.push({
        id: randomUUID(),
        productId: product.id,
        userId: buyer.id,
        orderItemId,
        rating: content.rating,
        title: content.title,
        body: content.body,
        status: 'APPROVED',
        helpfulCount: content.helpfulCount,
        unhelpfulCount: content.unhelpfulCount,
        media: JSON.stringify(
          product.imageUrl && rng() < 0.12
            ? [{ url: product.imageUrl, type: 'IMAGE', durationSeconds: null }]
            : [],
        ),
        vendorResponse: content.vendorResponse,
        vendorRespondedAt: content.vendorResponse ? new Date(reviewedAt.getTime() + DAY_MS) : null,
        createdBy: SEED_MARKER,
        createdAt: reviewedAt,
        updatedAt: reviewedAt,
      });
    }
  }
  return { groups: [...groups.values()], reviews, buyersByProduct };
}

function orderRows(groups) {
  const orders = [];
  const subOrders = [];
  const items = [];
  for (const group of groups) {
    const subtotalPaise = group.items.reduce((sum, item) => sum + item.pricePaise, 0);
    const rupees = (subtotalPaise / 100).toFixed(2);
    const stamp = { createdBy: SEED_MARKER, createdAt: group.date, updatedAt: group.date };
    orders.push({
      id: group.orderId,
      userId: group.userId,
      shippingAddressId: group.addressId,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      paymentMethod: 'COD',
      totalAmount: rupees,
      originalTotalAmount: rupees,
      merchandiseSubtotal: rupees,
      ...stamp,
    });
    subOrders.push({
      id: group.subOrderId,
      orderId: group.orderId,
      vendorId: group.vendorId,
      status: 'DELIVERED',
      subtotalPaise,
      customerTotal: rupees,
      shippingCharged: '0.00',
      ...stamp,
    });
    for (const item of group.items) {
      const price = (item.pricePaise / 100).toFixed(2);
      items.push({
        id: item.id,
        subOrderId: group.subOrderId,
        variantId: item.product.variantId,
        categoryId: item.product.categoryId,
        productName: item.product.name,
        quantity: 1,
        unitPricePaise: item.pricePaise,
        lineSubtotal: price,
        lineTotal: price,
        ...stamp,
      });
    }
  }
  return { orders, subOrders, items };
}

/** Questions (85% answered: seller first, then up to two buyers). */
function planQuestions(products, customers, buyersByProduct, now) {
  const questions = [];
  const answers = [];
  for (const product of products) {
    const rng = createRng(hashString(`${product.id}:qna`));
    const buyers = buyersByProduct.get(product.id) ?? customers;
    for (let i = 0; i < QUESTIONS_PER_PRODUCT; i += 1) {
      const askedAt = new Date(now - between(rng, 2, 360) * DAY_MS - between(rng, 0, 23) * 3_600_000);
      const { question, answers: replies } = buildQuestion(rng);
      const questionId = randomUUID();
      const asker = pick(rng, customers);
      const stamp = (at) => ({ createdBy: SEED_MARKER, createdAt: at, updatedAt: at });
      questions.push({
        id: questionId,
        productId: product.id,
        userId: asker.id,
        question,
        status: 'PUBLISHED',
        ...stamp(askedAt),
      });
      if (rng() >= 0.85) continue;

      let at = askedAt.getTime();
      // Distinct replies per question: two buyers never post the identical answer.
      const replyPool = shuffled(replies, rng);
      const answer = (authorId, authorType) => {
        if (!replyPool.length) return;
        at = Math.min(at + between(rng, 2, 72) * 3_600_000, now - 3_600_000);
        answers.push({
          id: randomUUID(),
          questionId,
          authorId,
          authorType,
          answer: replyPool.pop(),
          status: 'PUBLISHED',
          ...stamp(new Date(at)),
        });
      };
      if (product.vendorUserId && rng() < 0.75) answer(product.vendorUserId, 'VENDOR');
      const buyerAnswers = between(rng, product.vendorUserId ? 0 : 1, 2);
      // Buyers only (the C-01 rule), never the asker, each at most once per question.
      const answerers = shuffled(buyers.filter((b) => b.id !== asker.id), rng).slice(0, buyerAnswers);
      for (const buyer of answerers) answer(buyer.id, 'CUSTOMER');
    }
  }
  return { questions, answers };
}

async function refreshAvgRatings(sequelize, transaction) {
  await sequelize.query(
    `UPDATE products p SET "avgRating" = COALESCE((
       SELECT AVG(r.rating)::numeric(3,2) FROM reviews r
        WHERE r."productId" = p.id AND r.status = 'APPROVED' AND r."deletedAt" IS NULL), 0)
      WHERE p."deletedAt" IS NULL`,
    { transaction },
  );
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed(SEED_NAME);
    const sequelize = queryInterface.sequelize;
    const [{ count }] = await sequelize.query(
      'SELECT COUNT(*)::int AS count FROM reviews WHERE "createdBy" = :marker',
      { replacements: { marker: SEED_MARKER }, type: sequelize.QueryTypes.SELECT },
    );
    if (count > 0) {
      console.log('✓ Review/Q&A demo seed already present — skipped');
      return;
    }

    const { products, customers } = await loadInputs(sequelize);
    if (!products.length || !customers.length) {
      console.log('⚠ Skipping review/Q&A seed — needs products with variants and customers with an address');
      return;
    }

    const now = Date.now();
    const { groups, reviews, buyersByProduct } = planReviews(products, customers, now);
    const { orders, subOrders, items } = orderRows(groups);
    const { questions, answers } = planQuestions(products, customers, buyersByProduct, now);

    await sequelize.transaction(async (transaction) => {
      await insertChunked(queryInterface, 'orders', orders, transaction);
      await insertChunked(queryInterface, 'sub_orders', subOrders, transaction);
      await insertChunked(queryInterface, 'order_items', items, transaction);
      await insertChunked(queryInterface, 'reviews', reviews, transaction);
      await insertChunked(queryInterface, 'product_questions', questions, transaction);
      await insertChunked(queryInterface, 'product_answers', answers, transaction);
      await refreshAvgRatings(sequelize, transaction);
    });

    console.log(
      `✓ Seeded ${reviews.length} reviews (${orders.length} backing orders, ${items.length} lines), ` +
        `${questions.length} questions and ${answers.length} answers across ${products.length} products`,
    );
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.transaction(async (transaction) => {
      const opts = { replacements: { marker: SEED_MARKER }, transaction };
      // Reviews written later (through the app) on a seeded line would block deleting it.
      await sequelize.query(
        `DELETE FROM reviews WHERE "orderItemId" IN (SELECT id FROM order_items WHERE "createdBy" = :marker)`,
        opts,
      );
      for (const table of ['product_answers', 'product_questions', 'reviews', 'order_items', 'sub_orders', 'orders']) {
        await sequelize.query(`DELETE FROM ${table} WHERE "createdBy" = :marker`, opts);
      }
      await refreshAvgRatings(sequelize, transaction);
    });
  },
};
