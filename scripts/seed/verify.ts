/**
 * Checks the seeded database holds what the seed promises. Each check is a query that must
 * return nothing (or exactly the expected figure); any failure fails the seed.
 */
import { select } from './lib';
import { CUSTOMER_COUNT, VENDOR_COUNT, type Credentials } from './credentials';
import { LEAF_COUNT } from './taxonomy';

const MIN_PRODUCTS_PER_CATEGORY = 50;

type Check = { name: string; sql: string };

const LEAVES = `SELECT c.id, c.slug FROM categories c WHERE c."deletedAt" IS NULL AND c.status = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM categories k WHERE k."parentId" = c.id AND k."deletedAt" IS NULL)`;
const ON_SALE = `p.status = 'LIVE' AND p."deletedAt" IS NULL AND p."aboveMrp" = false`;

/** Queries that must return no rows. */
const EMPTY: Check[] = [
  { name: 'roles other than the three', sql: `SELECT name FROM roles WHERE name NOT IN ('SUPER_ADMIN', 'VENDOR_OWNER', 'CUSTOMER')` },
  { name: 'accounts not on yopmail.com', sql: `SELECT email FROM users WHERE email NOT LIKE '%@yopmail.com'` },
  { name: 'repeated email addresses', sql: `SELECT lower(email) FROM users GROUP BY 1 HAVING count(*) > 1` },
  { name: 'vendor logins without a store', sql: `SELECT u.id FROM users u JOIN roles r ON r.id = u."roleId" WHERE r.name = 'VENDOR_OWNER' AND u."vendorId" IS NULL` },
  { name: 'other accounts linked to a store', sql: `SELECT u.id FROM users u JOIN roles r ON r.id = u."roleId" WHERE r.name <> 'VENDOR_OWNER' AND u."vendorId" IS NOT NULL` },
  { name: 'stores without exactly one login', sql: `SELECT v.id FROM vendors v LEFT JOIN users u ON u."vendorId" = v.id AND u."deletedAt" IS NULL GROUP BY v.id HAVING count(u.id) <> 1` },
  { name: 'stores not approved and KYC verified', sql: `SELECT id FROM vendors WHERE status <> 'APPROVED' OR "kycVerified" = false` },
  {
    name: 'vendor and category pairs without a live product',
    sql: `SELECT v.slug, l.slug FROM vendors v CROSS JOIN (${LEAVES}) l
          WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p."vendorId" = v.id AND p."categoryId" = l.id AND ${ON_SALE})`,
  },
  {
    name: `categories with fewer than ${MIN_PRODUCTS_PER_CATEGORY} live products`,
    sql: `SELECT l.slug, count(p.id) FROM (${LEAVES}) l LEFT JOIN products p ON p."categoryId" = l.id AND ${ON_SALE}
          GROUP BY l.slug HAVING count(p.id) < ${MIN_PRODUCTS_PER_CATEGORY}`,
  },
  { name: 'categories without a GST rule', sql: `SELECT l.slug FROM (${LEAVES}) l WHERE NOT EXISTS (SELECT 1 FROM tax_rules t WHERE t."categoryId" = l.id AND t."deletedAt" IS NULL)` },
  { name: 'live products without an image', sql: `SELECT p.id FROM products p WHERE ${ON_SALE} AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i."productId" = p.id AND i."deletedAt" IS NULL)` },
  { name: 'live products with nothing in stock', sql: `SELECT p.id FROM products p WHERE ${ON_SALE} AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v."productId" = p.id AND v."deletedAt" IS NULL AND v.stock > 0)` },
  { name: 'variants priced above the MRP', sql: `SELECT id FROM product_variants WHERE "aboveMrp" = true` },
  { name: 'unpriced orders', sql: `SELECT id FROM orders WHERE "taxTotal" IS NULL` },
  { name: 'order parts without money', sql: `SELECT id FROM sub_orders WHERE "customerTotal" IS NULL` },
  {
    name: 'orders whose total differs from their parts by more than one rupee',
    sql: `SELECT o.id, o."totalAmount", sum(s."customerTotal") FROM orders o JOIN sub_orders s ON s."orderId" = o.id AND s."deletedAt" IS NULL
          GROUP BY o.id HAVING abs(o."totalAmount" - sum(s."customerTotal") - COALESCE(o."giftWrapFeeAmount", 0)) > 1`,
  },
  {
    name: 'wallet balances that are negative',
    sql: `SELECT "userId" FROM wallet_ledgers WHERE "balanceAfter" < 0`,
  },
  { name: 'emails still waiting to be sent', sql: `SELECT id FROM notification_logs WHERE status = 'PENDING'` },
  {
    name: 'resolved tickets already past the reopen window (they would be closed and mailed at once)',
    sql: `SELECT id FROM support_tickets WHERE status = 'RESOLVED' AND "resolvedAt" < now() - interval '8 days'`,
  },
  { name: 'unpaid online checkouts', sql: `SELECT id FROM orders WHERE "paymentStatus" = 'PENDING' AND "paymentMethod" = 'RAZORPAY'` },
  {
    name: 'buyer answers from someone who never received the product',
    sql: `SELECT a.id FROM product_answers a JOIN product_questions q ON q.id = a."questionId" WHERE a."authorType" = 'CUSTOMER' AND NOT EXISTS (
            SELECT 1 FROM order_items i JOIN sub_orders s ON s.id = i."subOrderId" AND s.status IN ('DELIVERED', 'RETURNED')
            JOIN orders o ON o.id = s."orderId" JOIN product_variants v ON v.id = i."variantId"
            WHERE o."userId" = a."authorId" AND v."productId" = q."productId")`,
  },
  {
    name: 'vendors without orders, delivered parts or payouts',
    sql: `SELECT v.slug FROM vendors v WHERE NOT EXISTS (SELECT 1 FROM sub_orders s WHERE s."vendorId" = v.id AND s.status = 'DELIVERED')
          OR NOT EXISTS (SELECT 1 FROM payouts p WHERE p."vendorId" = v.id)`,
  },
];

/** Figures that must match exactly. */
const COUNTS: Array<Check & { expected: number }> = [
  { name: 'super admins', expected: 1, sql: `SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u."roleId" WHERE r.name = 'SUPER_ADMIN'` },
  { name: 'vendor logins', expected: VENDOR_COUNT, sql: `SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u."roleId" WHERE r.name = 'VENDOR_OWNER'` },
  { name: 'customers', expected: CUSTOMER_COUNT, sql: `SELECT count(*)::int AS n FROM users u JOIN roles r ON r.id = u."roleId" WHERE r.name = 'CUSTOMER'` },
  { name: 'all accounts', expected: 1 + VENDOR_COUNT + CUSTOMER_COUNT, sql: 'SELECT count(*)::int AS n FROM users' },
  { name: 'stores', expected: VENDOR_COUNT, sql: 'SELECT count(*)::int AS n FROM vendors' },
  { name: 'leaf categories', expected: LEAF_COUNT, sql: `SELECT count(*)::int AS n FROM (${LEAVES}) l` },
];

export async function verify(credentials: Credentials): Promise<void> {
  const failures: string[] = [];
  for (const check of COUNTS) {
    const [row] = await select<{ n: number }>(check.sql);
    if (row!.n !== check.expected) failures.push(`${check.name}: expected ${check.expected}, found ${row!.n}`);
    else console.log(`  ✓ ${check.name}: ${row!.n}`);
  }
  for (const check of EMPTY) {
    const rows = await select<Record<string, unknown>>(`SELECT * FROM (${check.sql}) q LIMIT 4`);
    if (rows.length) failures.push(`${check.name}: ${JSON.stringify(rows.slice(0, 3))}`);
    else console.log(`  ✓ no ${check.name}`);
  }
  const expected = [credentials.superAdmin, ...credentials.vendors, ...credentials.customers];
  const [matched] = await select<{ n: number }>('SELECT count(*)::int AS n FROM users WHERE email IN (:expected)', { expected });
  if (matched!.n !== expected.length) failures.push(`accounts matching the credentials file: expected ${expected.length}, found ${matched!.n}`);
  if (failures.length) throw new Error(`Seed checks failed:\n  - ${failures.join('\n  - ')}`);
}
