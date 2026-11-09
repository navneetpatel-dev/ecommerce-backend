/**
 * Coverage check printed at the end of the seed: for each page a customer or a selling
 * vendor owns, the smallest number of rows any one account has, and the platform totals
 * the admin pages read. "min" is the emptiest account, so 100+ there means 100+ for all.
 */
import { select } from './lib';
import type { Accounts } from './accounts';

const CUSTOMER_METRICS: Record<string, string> = {
  Orders: `SELECT "userId" AS k, count(*) FROM orders GROUP BY 1`,
  Addresses: `SELECT "userId" AS k, count(*) FROM addresses GROUP BY 1`,
  'Wishlist items': `SELECT w."userId" AS k, count(*) FROM wishlist_items i JOIN wishlists w ON w.id = i."wishlistId" GROUP BY 1`,
  'Cart items': `SELECT c."userId" AS k, count(*) FROM cart_items i JOIN carts c ON c.id = i."cartId" GROUP BY 1`,
  'Wallet entries': `SELECT "userId" AS k, count(*) FROM wallet_ledgers GROUP BY 1`,
  'Cashback rows': `SELECT "userId" AS k, count(*) FROM orders WHERE status <> 'PENDING' AND ("pendingCashbackAmount" > 0 OR "cashbackCreditedAt" IS NOT NULL) GROUP BY 1`,
  'Gift cards sent': `SELECT "purchaserId" AS k, count(*) FROM gift_cards GROUP BY 1`,
  'Gift cards redeemed': `SELECT "redeemedByUserId" AS k, count(*) FROM gift_cards WHERE "redeemedByUserId" IS NOT NULL GROUP BY 1`,
  Reviews: `SELECT "userId" AS k, count(*) FROM reviews GROUP BY 1`,
  Returns: `SELECT "userId" AS k, count(*) FROM return_requests GROUP BY 1`,
  'Support tickets': `SELECT "customerId" AS k, count(*) FROM support_tickets GROUP BY 1`,
  'Bug reports': `SELECT "reporterId" AS k, count(*) FROM bug_reports GROUP BY 1`,
  'Recently viewed': `SELECT "userId" AS k, count(*) FROM recently_viewed_items GROUP BY 1`,
  'Stock alerts': `SELECT "userId" AS k, count(*) FROM stock_alerts GROUP BY 1`,
  'Saved payment methods': `SELECT "userId" AS k, count(*) FROM saved_payment_methods GROUP BY 1`,
  Notifications: `SELECT "userId" AS k, count(*) FROM notification_logs GROUP BY 1`,
  'Report exports': `SELECT "ownerId" AS k, count(*) FROM export_jobs GROUP BY 1`,
  'Signed-in sessions': `SELECT "userId" AS k, count(*) FROM refresh_tokens GROUP BY 1`,
};

const VENDOR_METRICS: Record<string, string> = {
  Products: `SELECT "vendorId" AS k, count(*) FROM products GROUP BY 1`,
  'Order parts': `SELECT "vendorId" AS k, count(*) FROM sub_orders GROUP BY 1`,
  Returns: `SELECT s."vendorId" AS k, count(*) FROM return_requests r JOIN sub_orders s ON s.id = r."subOrderId" GROUP BY 1`,
  'Product reviews': `SELECT p."vendorId" AS k, count(*) FROM reviews r JOIN products p ON p.id = r."productId" GROUP BY 1`,
  'Product questions': `SELECT p."vendorId" AS k, count(*) FROM product_questions q JOIN products p ON p.id = q."productId" GROUP BY 1`,
  Coupons: `SELECT "vendorId" AS k, count(*) FROM coupons GROUP BY 1`,
  Payouts: `SELECT "vendorId" AS k, count(*) FROM payouts GROUP BY 1`,
  'Commission ledger': `SELECT "vendorId" AS k, count(*) FROM commission_ledgers GROUP BY 1`,
  'Commission invoices': `SELECT "vendorId" AS k, count(*) FROM commission_invoices GROUP BY 1`,
  'TCS entries': `SELECT "vendorId" AS k, count(*) FROM tcs_ledgers GROUP BY 1`,
  'TDS entries': `SELECT "vendorId" AS k, count(*) FROM tds_ledgers GROUP BY 1`,
  'Credit notes': `SELECT "vendorId" AS k, count(*) FROM credit_notes GROUP BY 1`,
  'Debit notes': `SELECT "vendorId" AS k, count(*) FROM debit_notes GROUP BY 1`,
  'Owner tickets': `SELECT u."vendorId" AS k, count(*) FROM support_tickets t JOIN users u ON u.id = t."customerId" JOIN roles r ON r.id = u."roleId" WHERE r.name = 'VENDOR_OWNER' GROUP BY 1`,
  'Owner bug reports': `SELECT u."vendorId" AS k, count(*) FROM bug_reports b JOIN users u ON u.id = b."reporterId" JOIN roles r ON r.id = u."roleId" WHERE r.name = 'VENDOR_OWNER' GROUP BY 1`,
};

const TABLES = ['users', 'vendors', 'products', 'categories', 'category_attributes', 'tax_rules', 'orders', 'sub_orders', 'order_items', 'shipments', 'shipment_attempts', 'return_requests', 'credit_notes', 'debit_notes', 'coupons', 'coupon_batches', 'coupon_usages', 'cashback_offers', 'promo_banners', 'gift_cards', 'wallet_ledgers', 'wallet_recharge_orders', 'wallet_write_offs', 'payouts', 'commission_ledgers', 'commission_invoices', 'tcs_ledgers', 'tds_ledgers', 'reviews', 'review_votes', 'product_questions', 'product_answers', 'support_tickets', 'ticket_messages', 'bug_reports', 'notification_logs', 'audit_logs', 'export_jobs', 'webhook_events', 'web_vitals', 'product_affinities', 'roles'];

async function minimum(sql: string, keys: string[]): Promise<number> {
  const counts = new Map((await select<{ k: string; count: string }>(sql)).map((row) => [row.k, Number(row.count)]));
  return keys.reduce((low, key) => Math.min(low, counts.get(key) ?? 0), Infinity);
}

export async function printCoverage(accounts: Accounts): Promise<void> {
  const customers = accounts.customers.map((c) => c.id);
  const vendors = accounts.sellingVendors.map((v) => v.id);
  console.log(`\nPer customer (${customers.length} accounts) — fewest rows any one has:`);
  for (const [name, sql] of Object.entries(CUSTOMER_METRICS)) console.log(`  ${name.padEnd(24)} ${await minimum(sql, customers)}`);
  console.log(`\nPer selling vendor (${vendors.length} shops) — fewest rows any one has:`);
  for (const [name, sql] of Object.entries(VENDOR_METRICS)) console.log(`  ${name.padEnd(24)} ${await minimum(sql, vendors)}`);
  console.log('\nPlatform totals (admin pages):');
  for (const table of TABLES) {
    const [row] = await select<{ c: string }>(`SELECT count(*)::text AS c FROM "${table}"`);
    console.log(`  ${table.padEnd(24)} ${row!.c}`);
  }
}
