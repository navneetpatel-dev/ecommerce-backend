/**
 * The system around the shop: 100+ notification log entries, report exports and signed-in
 * sessions per account, an audit trail of staff and vendor actions, Razorpay and carrier
 * webhook events, web-vitals samples, OTPs, push subscriptions and newsletter sign-ups.
 */
import { createHash } from 'node:crypto';
import { NOW, addDays, addHours, between, chance, exec, id, insert, int, json, pick, select, weighted } from './lib';
import { scaled } from './scale';
import type { Accounts } from './accounts';

const PER_ACCOUNT = scaled(105, 3);
const AUDIT_ROWS = scaled(5000, 60);

const CUSTOMER_NOTIFICATIONS = ['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT', 'SUBORDER_SHIPPED', 'SUBORDER_DELIVERED', 'ORDER_CANCELLED', 'REFUND_INITIATED', 'REFUND_PROCESSED', 'REVIEW_REQUEST', 'BACK_IN_STOCK', 'PRICE_DROP_ALERT', 'TICKET_REPLIED', 'ABANDONED_CART', 'COUPON_OFFER_EXPIRING'];
const VENDOR_NOTIFICATIONS = ['PAYOUT_PROCESSED', 'PAYOUT_PAID', 'PRODUCT_APPROVED', 'PRODUCT_REJECTED', 'LOW_STOCK_ALERT', 'SUBORDER_CANCELLED', 'ORDER_RETURNED', 'TICKET_RESOLVED', 'KYC_DOCUMENT_REJECTED', 'COUPON_USAGE_LIMIT'];
const ADMIN_NOTIFICATIONS = ['ADMIN_NEW_VENDOR_PENDING', 'TICKET_CREATED', 'TICKET_REOPENED', 'PAYOUT_FAILED', 'ADMIN_BROADCAST'];
const CUSTOMER_REPORTS = ['customer-wallet-statement', 'customer-order-history'];
const VENDOR_REPORTS = ['vendor-sales', 'vendor-settlement', 'vendor-payout-statement', 'vendor-gst-sales', 'vendor-inventory', 'vendor-return-refund', 'vendor-tcs-credit', 'vendor-tds-certificate'];
const ADMIN_REPORTS = ['gmv-sales', 'commission-revenue', 'gstr-1-filing', 'tds-194o-summary', 'wallet-liability', 'gift-card-liability', 'refund-return', 'support-ticket-sla', 'vendor-payout-reconciliation', 'audit-log'];

type Person = { id: string; kind: 'CUSTOMER' | 'VENDOR' | 'ADMIN'; createdAt: Date };

async function people(accounts: Accounts): Promise<Person[]> {
  const vendorUsers = await select<{ id: string; createdAt: Date }>(`SELECT id, "createdAt" FROM users WHERE "vendorId" IS NOT NULL`);
  const admins = await select<{ id: string; createdAt: Date }>(`SELECT id, "createdAt" FROM users WHERE id IN (:ids)`, { ids: accounts.adminIds });
  return [
    ...accounts.customers.map((c) => ({ id: c.id, kind: 'CUSTOMER' as const, createdAt: c.createdAt })),
    ...vendorUsers.map((u) => ({ id: u.id, kind: 'VENDOR' as const, createdAt: u.createdAt })),
    ...admins.map((u) => ({ id: u.id, kind: 'ADMIN' as const, createdAt: u.createdAt })),
  ];
}

async function seedPerAccount(everyone: Person[]) {
  const notifications: Array<Record<string, unknown>> = [];
  const exports: Array<Record<string, unknown>> = [];
  const sessions: Array<Record<string, unknown>> = [];
  const flush = async () => {
    await insert('notification_logs', notifications.splice(0));
    await insert('export_jobs', exports.splice(0));
    await insert('refresh_tokens', sessions.splice(0));
  };
  for (const [index, person] of everyone.entries()) {
    const types = person.kind === 'CUSTOMER' ? CUSTOMER_NOTIFICATIONS : person.kind === 'VENDOR' ? VENDOR_NOTIFICATIONS : ADMIN_NOTIFICATIONS;
    const reports = person.kind === 'CUSTOMER' ? CUSTOMER_REPORTS : person.kind === 'VENDOR' ? VENDOR_REPORTS : ADMIN_REPORTS;
    for (let n = 0; n < PER_ACCOUNT; n += 1) {
      const at = between(person.createdAt, NOW);
      const status = weighted([['SENT', 88], ['FAILED', 4], ['BOUNCED', 3], ['PENDING', 3], ['COMPLAINED', 2]] as const);
      notifications.push({
        id: id(), userId: person.id, type: pick(types), referenceType: pick(['Order', 'SubOrder', 'Payout', 'Product', 'SupportTicket']), referenceId: id(),
        channel: weighted([['EMAIL', 80], ['PUSH', 15], ['SMS', 5]] as const), status,
        providerMessageId: status === 'SENT' ? `msg_${id().slice(0, 18)}` : null,
        error: status === 'FAILED' || status === 'BOUNCED' ? 'Mailbox unavailable (550)' : null, sentAt: status === 'SENT' ? at : null,
        createdAt: at, updatedAt: at,
      });
      // Exports: finished ones have expired (their files are gone), plus failed and cancelled runs.
      const exportStatus = n < 3 ? pick(['QUEUED', 'PROCESSING']) : weighted([['COMPLETED', 80], ['FAILED', 12], ['CANCELLED', 8]] as const);
      const started = between(addDays(NOW, -300), addDays(NOW, -1));
      const type = pick(reports);
      const rows = int(50, 20_000);
      exports.push({
        id: id(), ownerId: person.id, domain: 'report', exportType: type, format: pick(['csv', 'xlsx', 'pdf']), status: exportStatus,
        filters: json({ from: addDays(started, -30).toISOString().slice(0, 10), to: started.toISOString().slice(0, 10) }),
        progressPercent: exportStatus === 'COMPLETED' ? 100 : exportStatus === 'PROCESSING' ? int(10, 90) : 0,
        rowsProcessed: exportStatus === 'COMPLETED' ? rows : 0, totalRowsEstimate: rows,
        resultKey: exportStatus === 'COMPLETED' ? `exports/${person.id}/${type}-${n}.csv` : null,
        filename: exportStatus === 'COMPLETED' ? `${type}-${started.toISOString().slice(0, 10)}.csv` : null, byteSize: exportStatus === 'COMPLETED' ? rows * 120 : null,
        errorMessage: exportStatus === 'FAILED' ? 'The report timed out; try a shorter date range.' : null, errorCode: exportStatus === 'FAILED' ? 'EXPORT_TIMEOUT' : null,
        startedAt: exportStatus === 'QUEUED' ? null : started, completedAt: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(exportStatus) ? addHours(started, 0.1) : null,
        expiresAt: exportStatus === 'COMPLETED' ? addHours(started, 24) : null, acknowledgedAt: exportStatus === 'COMPLETED' && chance(0.8) ? addHours(started, 1) : null,
        createdAt: started, updatedAt: started,
      });
      // Signed-in devices: active sessions on phones, laptops and tablets.
      const seen = between(addDays(NOW, -25), NOW);
      sessions.push({
        id: id(), userId: person.id, tokenHash: createHash('sha256').update(id()).digest('hex'), expiresAt: addDays(seen, 30), family: id(),
        userAgent: pick(['Chrome 131 on Windows', 'Safari 18 on iPhone', 'Chrome 131 on Android', 'Firefox 132 on macOS', 'Edge 131 on Windows', 'Safari 18 on iPad']),
        ipAddress: `49.${int(32, 47)}.${int(0, 255)}.${int(1, 254)}`, lastUsedAt: seen, createdAt: addDays(seen, -int(0, 5)), updatedAt: seen,
      });
    }
    if (index % 50 === 49) await flush();
  }
  await flush();
}

async function seedAudit(accounts: Accounts) {
  const sample = async (sql: string) => (await select<{ id: string }>(sql)).map((row) => row.id);
  const entities: Record<string, string[]> = {
    Order: await sample('SELECT id FROM orders ORDER BY random() LIMIT 2000'),
    Product: await sample('SELECT id FROM products ORDER BY random() LIMIT 2000'),
    Vendor: accounts.vendors.map((vendor) => vendor.id),
    User: accounts.customers.map((customer) => customer.id),
    Coupon: await sample('SELECT id FROM coupons ORDER BY random() LIMIT 500'),
    Review: await sample('SELECT id FROM reviews ORDER BY random() LIMIT 1000'),
    Payout: await sample('SELECT id FROM payouts ORDER BY random() LIMIT 1000'),
    ReturnRequest: await sample('SELECT id FROM return_requests ORDER BY random() LIMIT 1000'),
    GiftCard: await sample('SELECT id FROM gift_cards ORDER BY random() LIMIT 500'),
    CashbackOffer: await sample('SELECT id FROM cashback_offers'),
  };
  const actions: Array<[string, string]> = [
    ['ORDER_STATUS_UPDATED', 'Order'], ['ORDER_CANCELLED', 'Order'], ['PRODUCT_APPROVED', 'Product'], ['PRODUCT_REJECTED', 'Product'],
    ['VENDOR_APPROVED', 'Vendor'], ['VENDOR_SUSPENDED', 'Vendor'], ['USER_BLOCKED', 'User'], ['WALLET_ADJUSTED', 'User'],
    ['COUPON_CREATED', 'Coupon'], ['COUPON_UPDATED', 'Coupon'], ['REVIEW_MODERATED', 'Review'], ['PAYOUT_MARKED_PAID', 'Payout'],
    ['RETURN_APPROVED', 'ReturnRequest'], ['RETURN_REFUNDED', 'ReturnRequest'], ['GIFT_CARD_CANCELLED', 'GiftCard'], ['CASHBACK_OFFER_UPDATED', 'CashbackOffer'],
  ];
  const rows: Array<Record<string, unknown>> = [];
  for (let n = 0; n < AUDIT_ROWS; n += 1) {
    const [action, entityType] = pick(actions);
    const pool = entities[entityType] ?? [];
    if (pool.length === 0) continue;
    const at = between(addDays(NOW, -720), NOW);
    const vendorAction = entityType === 'Product' && chance(0.4);
    rows.push({
      id: id(), actorId: vendorAction ? pick(accounts.sellingVendors).ownerId : pick(accounts.adminIds), action, entityType, entityId: pick(pool),
      metadata: json({ reason: pick(['Routine check', 'Customer request', 'Policy violation', 'Seller request']), ip: `49.36.${int(0, 255)}.${int(1, 254)}` }),
      createdAt: at, updatedAt: at,
    });
  }
  await insert('audit_logs', rows);
}

async function seedPlatform(accounts: Accounts) {
  const webhooks: Array<Record<string, unknown>> = [];
  for (let n = 0; n < scaled(600, 10); n += 1) {
    const at = between(addDays(NOW, -720), NOW);
    const carrier = n % 3 === 0;
    const event = carrier ? pick(['shipment.in_transit', 'shipment.delivered', 'shipment.rto_initiated']) : pick(['payment.captured', 'payment.failed', 'refund.processed', 'order.paid']);
    webhooks.push({ id: id(), provider: carrier ? pick(['delhivery', 'bluedart']) : 'razorpay', eventId: `evt_${id().replace(/-/g, '').slice(0, 20)}`, payload: json({ event, created_at: Math.floor(at.getTime() / 1000), payload: { id: `pay_${id().slice(0, 14)}` } }), createdAt: at, updatedAt: at });
  }
  await insert('webhook_events', webhooks);

  const vitals: Array<Record<string, unknown>> = [];
  const limits: Record<string, [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };
  for (let n = 0; n < scaled(3000, 50); n += 1) {
    const name = pick(Object.keys(limits));
    const [good, poor] = limits[name]!;
    const value = name === 'CLS' ? Math.round(Math.random() * 0.4 * 1000) / 1000 : Math.round(Math.random() * poor * 1.4);
    const at = between(addDays(NOW, -90), NOW);
    vitals.push({ id: id(), name, value, rating: value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor', path: pick(['/', '/products', '/cart', '/checkout', '/orders', '/vendor/dashboard/overview']), effectiveType: pick(['4g', '4g', '3g', 'wifi']), userId: chance(0.6) ? pick(accounts.customers).id : null, createdAt: at, updatedAt: at });
  }
  await insert('web_vitals', vitals);

  const otps = accounts.customers.slice(0, scaled(300, 5)).map((customer) => {
    const at = between(addDays(NOW, -30), NOW);
    return { id: id(), userId: customer.id, channel: 'EMAIL', purpose: 'LOGIN', codeHash: createHash('sha256').update(String(int(100000, 999999))).digest('hex'), expiresAt: addHours(at, 0.17), consumedAt: chance(0.7) ? addHours(at, 0.05) : null, attempts: int(0, 3), createdAt: at, updatedAt: at };
  });
  await insert('otp_codes', otps);
  await insert('push_subscriptions', accounts.customers.filter(() => chance(0.6)).map((customer) => {
    const at = between(customer.createdAt, NOW);
    return { id: id(), userId: customer.id, endpoint: `https://fcm.googleapis.com/fcm/send/${id()}`, p256dhKey: createHash('sha256').update(customer.id).digest('base64'), authKey: id().slice(0, 22), userAgent: 'Chrome 131 on Android', createdAt: at, updatedAt: at };
  }));
  const subscribers = new Set((await select<{ email: string }>('SELECT email FROM newsletter_subscribers')).map((row) => row.email));
  const signups = [...accounts.customers.map((c) => c.email), ...Array.from({ length: scaled(400, 5) }, (_, n) => `reader${n}@example.org`)]
    .filter((email) => !subscribers.has(email))
    .map((email) => {
      const at = between(addDays(NOW, -720), NOW);
      return { id: id(), email, createdAt: at, updatedAt: at };
    });
  await insert('newsletter_subscribers', signups);
}

export async function seedSystem(accounts: Accounts): Promise<void> {
  await seedPerAccount(await people(accounts));
  await seedAudit(accounts);
  await seedPlatform(accounts);
  // Coupon usage counters match the orders that used them.
  await exec(`UPDATE coupons c SET "usedCount" = u.n FROM (SELECT "couponId", count(*) AS n FROM coupon_usages GROUP BY 1) u WHERE u."couponId" = c.id`);
}
