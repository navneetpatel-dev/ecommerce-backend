/**
 * What customers do around their orders, 100+ of each per customer (and per vendor where
 * the vendor has a page for it): reviews of delivered items (photos and video, votes,
 * vendor replies, every moderation state), questions and answers on every vendor's
 * products, wishlists, carts, recently viewed products, back-in-stock alerts, saved
 * payment methods, and "frequently bought together" from what was ordered together.
 */
import { NOW, addDays, between, chance, exec, id, insert, int, json, minDate, pick, sample, select, weighted, photo } from './lib';
import { scaled } from './scale';
import type { Accounts } from './accounts';
import type { Catalog } from './catalog';

const PER_CUSTOMER = scaled(105, 4);
const QUESTIONS_PER_VENDOR = scaled(110, 4);

const REVIEW_TEXT: Record<number, Array<[string, string]>> = {
  5: [['Absolutely love it', 'Exceeded expectations. Build quality is excellent and it arrived well packed.'], ['Worth every rupee', 'Using it daily for weeks now, no complaints at all.']],
  4: [['Very good', 'Good quality and quick delivery. Packaging could be a little better.'], ['Happy with it', 'Does what it says. Would buy again from this seller.']],
  3: [['Okay for the price', 'Average quality. It works, but nothing special.'], ['Decent', 'Took a while to arrive, product is fine.']],
  2: [['Not great', 'Material feels cheaper than shown in the photos.'], ['Disappointed', 'Stopped working properly after two weeks.']],
  1: [['Poor', 'Received a damaged piece and had to return it.'], ['Would not recommend', 'Nothing like the description.']],
};

async function seedReviews(accounts: Accounts) {
  const delivered = await select<{ itemId: string; productId: string; userId: string; vendorId: string; at: Date }>(`
    SELECT i.id AS "itemId", v."productId", o."userId", s."vendorId", COALESCE(sh."deliveredAt", s."updatedAt") AS at
    FROM order_items i JOIN sub_orders s ON s.id = i."subOrderId" JOIN orders o ON o.id = s."orderId"
    JOIN product_variants v ON v.id = i."variantId" LEFT JOIN shipments sh ON sh."subOrderId" = s.id
    WHERE s.status = 'DELIVERED' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r."orderItemId" = i.id)`);
  const byUser = new Map<string, typeof delivered>();
  for (const row of delivered) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  const vendorOwner = new Map(accounts.vendors.map((vendor) => [vendor.id, vendor.ownerId]));
  const reviews: Array<Record<string, unknown>> = [];
  const votes: Array<Record<string, unknown>> = [];
  const voters = accounts.customers.map((customer) => customer.id);
  for (const customer of accounts.customers) {
    for (const line of sample(byUser.get(customer.id) ?? [], PER_CUSTOMER)) {
      const rating = weighted([[5, 45], [4, 30], [3, 12], [2, 7], [1, 6]] as const);
      const [title, body] = pick(REVIEW_TEXT[rating]!);
      const status = weighted([['APPROVED', 80], ['PENDING', 12], ['REJECTED', 8]] as const);
      const at = minDate(addDays(line.at, int(2, 20)), NOW);
      const media = status !== 'REJECTED' && chance(0.18)
        ? [
            ...Array.from({ length: int(1, 5) }, (_, n) => ({ url: photo(`rv-${line.itemId.slice(0, 8)}-${n}`), type: 'IMAGE', durationSeconds: null })),
            ...(chance(0.3) ? [{ url: 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4', type: 'VIDEO', durationSeconds: 5 }] : []),
          ]
        : [];
      const reviewId = id();
      const replied = status === 'APPROVED' && chance(0.3);
      let helpful = 0;
      let unhelpful = 0;
      if (status === 'APPROVED') {
        for (const voter of sample(voters, int(0, 4))) {
          if (voter === customer.id) continue;
          const vote = chance(0.85) ? 'HELPFUL' : 'UNHELPFUL';
          if (vote === 'HELPFUL') helpful += 1;
          else unhelpful += 1;
          const votedAt = minDate(addDays(at, int(1, 30)), NOW);
          votes.push({ id: id(), reviewId, userId: voter, vote, createdAt: votedAt, updatedAt: votedAt });
        }
      }
      reviews.push({
        id: reviewId, productId: line.productId, userId: customer.id, orderItemId: line.itemId, rating, title, body, status,
        helpfulCount: helpful, unhelpfulCount: unhelpful, media: json(media),
        vendorResponse: replied ? pick(['Thank you for the kind words!', 'Sorry about the trouble; our team has reached out to you.', 'Glad you liked it. Happy shopping!']) : null,
        vendorRespondedAt: replied ? minDate(addDays(at, 2), NOW) : null, updatedBy: replied ? vendorOwner.get(line.vendorId) : null,
        createdAt: at, updatedAt: at,
      });
    }
  }
  await insert('reviews', reviews);
  await insert('review_votes', votes);
  await exec(`
    UPDATE products p SET "avgRating" = r.avg FROM (
      SELECT "productId", round(avg(rating)::numeric, 2) AS avg FROM reviews WHERE status = 'APPROVED' AND "deletedAt" IS NULL GROUP BY 1
    ) r WHERE r."productId" = p.id`);
  console.log(`  ${reviews.length} reviews, ${votes.length} votes`);
}

async function seedQuestions(accounts: Accounts, catalog: Catalog) {
  const questions: Array<Record<string, unknown>> = [];
  const answers: Array<Record<string, unknown>> = [];
  const asks = ['Is this suitable for daily use?', 'Does it come with a warranty card?', 'What is the exact size?', 'Is the colour the same as in the photos?', 'Can it be gift wrapped?', 'Is it machine washable?', 'Does the box include a charger?'];
  for (const vendor of accounts.sellingVendors) {
    const products = [...new Set((catalog.liveByVendor.get(vendor.id) ?? []).map((row) => row.productId))];
    if (products.length === 0) continue;
    for (let n = 0; n < QUESTIONS_PER_VENDOR; n += 1) {
      const asker = pick(accounts.customers);
      const at = between(addDays(vendor.createdAt, 20), addDays(NOW, -1));
      const status = n < QUESTIONS_PER_VENDOR * 0.2 ? 'PENDING' : weighted([['PUBLISHED', 88], ['REJECTED', 12]] as const);
      const questionId = id();
      questions.push({ id: questionId, productId: pick(products), userId: asker.id, question: pick(asks), status, createdAt: at, updatedAt: at });
      if (status !== 'PUBLISHED') continue;
      const answeredAt = minDate(addDays(at, int(0, 3)), NOW);
      answers.push({ id: id(), questionId, authorId: chance(0.8) ? vendor.ownerId : (vendor.staffId ?? vendor.ownerId), authorType: 'VENDOR', answer: pick(['Yes, it is.', 'It comes with a 1-year manufacturer warranty.', 'Please check the size chart on the listing; it runs true to size.', 'Yes, gift wrap is available at checkout.']), status: 'PUBLISHED', createdAt: answeredAt, updatedAt: answeredAt });
      if (chance(0.3)) {
        const other = pick(accounts.customers);
        answers.push({ id: id(), questionId, authorId: other.id, authorType: 'CUSTOMER', answer: pick(['I have been using it for a month, works great.', 'Mine came exactly as pictured.']), status: pick(['PUBLISHED', 'PUBLISHED', 'PENDING']), createdAt: addDays(answeredAt, 2), updatedAt: addDays(answeredAt, 2) });
      }
    }
  }
  await insert('product_questions', questions);
  await insert('product_answers', answers);
  console.log(`  ${questions.length} questions, ${answers.length} answers`);
}

async function seedLists(accounts: Accounts, catalog: Catalog) {
  const wishlists = new Map((await select<{ id: string; userId: string }>('SELECT id, "userId" FROM wishlists')).map((row) => [row.userId, row.id]));
  const wished = new Set((await select<{ w: string; p: string }>('SELECT "wishlistId" AS w, "productId" AS p FROM wishlist_items')).map((row) => `${row.w}:${row.p}`));
  const carts = new Map((await select<{ id: string; userId: string }>('SELECT id, "userId" FROM carts WHERE "userId" IS NOT NULL')).map((row) => [row.userId, row.id]));
  const inCart = new Set((await select<{ c: string; v: string }>('SELECT "cartId" AS c, "variantId" AS v FROM cart_items')).map((row) => `${row.c}:${row.v}`));
  const outOfStock = await select<{ id: string }>(`SELECT v.id FROM product_variants v JOIN products p ON p.id = v."productId" WHERE v.stock = 0 AND p.status = 'LIVE'`);
  const price = new Map(catalog.liveVariants.map((row) => [row.productId, row.price]));
  const newWishlists: Array<Record<string, unknown>> = [];
  const newCarts: Array<Record<string, unknown>> = [];
  const wishItems: Array<Record<string, unknown>> = [];
  const cartItems: Array<Record<string, unknown>> = [];
  const viewed: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const cards: Array<Record<string, unknown>> = [];
  for (const customer of accounts.customers) {
    let wishlistId = wishlists.get(customer.id);
    if (!wishlistId) {
      wishlistId = id();
      newWishlists.push({ id: wishlistId, userId: customer.id, createdAt: customer.createdAt, updatedAt: customer.createdAt });
    }
    for (const productId of sample(catalog.liveProductIds, PER_CUSTOMER)) {
      if (wished.has(`${wishlistId}:${productId}`)) continue;
      const at = between(customer.createdAt, NOW);
      // Some were added at a higher price, so the price-drop badge shows.
      const now = price.get(productId) ?? 100;
      wishItems.push({ id: id(), wishlistId, productId, priceAtAdd: chance(0.25) ? now + 2 * int(20, 200) : now, createdAt: at, updatedAt: at });
    }
    let cartId = carts.get(customer.id);
    if (!cartId) {
      cartId = id();
      newCarts.push({ id: cartId, userId: customer.id, createdAt: addDays(NOW, -int(0, 20)), updatedAt: NOW });
    }
    for (const line of sample(catalog.liveVariants, PER_CUSTOMER)) {
      if (inCart.has(`${cartId}:${line.variantId}`)) continue;
      inCart.add(`${cartId}:${line.variantId}`);
      const at = addDays(NOW, -int(0, 30));
      cartItems.push({ id: id(), cartId, variantId: line.variantId, quantity: weighted([[1, 80], [2, 15], [3, 5]] as const), createdAt: at, updatedAt: at });
    }
    sample(catalog.liveProductIds, PER_CUSTOMER).forEach((productId, n) => {
      const at = addDays(NOW, -n * 0.7 - Math.random());
      viewed.push({ id: id(), userId: customer.id, productId, viewedAt: at, createdAt: at, updatedAt: at });
    });
    for (const variant of sample(outOfStock, PER_CUSTOMER)) {
      const at = between(addDays(NOW, -200), NOW);
      alerts.push({ id: id(), userId: customer.id, variantId: variant.id, notifiedAt: chance(0.3) ? addDays(at, int(3, 20)) : null, createdAt: at, updatedAt: at });
    }
    for (let n = 0; n < PER_CUSTOMER; n += 1) {
      const card = chance(0.7);
      const at = between(customer.createdAt, NOW);
      cards.push({
        id: id(), userId: customer.id, razorpayCustomerId: `cust_${customer.id.replace(/-/g, '').slice(0, 14)}`, razorpayTokenId: `token_${id().replace(/-/g, '').slice(0, 16)}`,
        methodType: card ? 'card' : 'upi', cardLast4: card ? String(int(1000, 9999)) : null, cardNetwork: card ? pick(['Visa', 'MasterCard', 'RuPay', 'Amex']) : null,
        vpa: card ? null : `${customer.email.split('@')[0]!.replace(/\./g, '')}${n}@okaxis`, metadata: json(card ? { issuer: pick(['HDFC', 'ICICI', 'SBI', 'Axis']), expiry: `${int(1, 12)}/${int(27, 32)}` } : {}),
        createdAt: at,
      });
    }
  }
  await insert('wishlists', newWishlists);
  await insert('wishlist_items', wishItems);
  await insert('carts', newCarts);
  await insert('cart_items', cartItems);
  await insert('recently_viewed_items', viewed);
  await insert('stock_alerts', alerts);
  await insert('saved_payment_methods', cards);
  await exec(`UPDATE users u SET "razorpayCustomerId" = s.c FROM (SELECT DISTINCT "userId", "razorpayCustomerId" AS c FROM saved_payment_methods) s WHERE s."userId" = u.id AND u."razorpayCustomerId" IS NULL`);
}

/** "Frequently bought together": products bought in the same order, scored by how often. */
async function seedAffinities() {
  await exec(`
    INSERT INTO product_affinities (id, "productId", "relatedProductId", "coOccurrenceCount", score, "computedAt", "createdAt", "updatedAt")
    SELECT gen_random_uuid(), a.pid, b.pid, count(*), count(*)::float / 10, now(), now(), now()
    FROM (SELECT s."orderId", v."productId" AS pid FROM order_items i JOIN sub_orders s ON s.id = i."subOrderId" JOIN product_variants v ON v.id = i."variantId") a
    JOIN (SELECT s."orderId", v."productId" AS pid FROM order_items i JOIN sub_orders s ON s.id = i."subOrderId" JOIN product_variants v ON v.id = i."variantId") b
      ON a."orderId" = b."orderId" AND a.pid <> b.pid
    GROUP BY a.pid, b.pid
    ON CONFLICT ("productId", "relatedProductId") DO NOTHING`);
}

export async function seedEngagement(accounts: Accounts, catalog: Catalog): Promise<void> {
  await seedReviews(accounts);
  await seedQuestions(accounts, catalog);
  await seedLists(accounts, catalog);
  await seedAffinities();
}
