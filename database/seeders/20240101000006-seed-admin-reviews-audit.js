'use strict';

const { randomUUID } = require('crypto');

const PENDING_REVIEW_MARKER = '[Seed] Awaiting moderation';
const AUDIT_SEED_ACTION = 'SEED_AUDIT_FIXTURE';

/**
 * Idempotent fixtures for admin Reviews moderation + Audit log tables.
 * Run: npx sequelize-cli db:seed --seed 20240101000006-seed-admin-reviews-audit.js
 */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const sequelize = queryInterface.sequelize;

    const [admins] = await sequelize.query(
      `SELECT u.id FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE r.name IN ('SUPER_ADMIN', 'ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER')
       ORDER BY u."createdAt" ASC
       LIMIT 5`,
    );
    const [customers] = await sequelize.query(
      `SELECT u.id FROM users u
       INNER JOIN roles r ON r.id = u."roleId"
       WHERE r.name = 'CUSTOMER'
       ORDER BY u."createdAt" ASC
       LIMIT 20`,
    );
    const [products] = await sequelize.query(
      `SELECT id FROM products WHERE "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 30`,
    );
    const [vendors] = await sequelize.query(
      `SELECT id, "businessName" FROM vendors WHERE "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT 10`,
    );

    const actorId = admins[0]?.id;
    if (!actorId) {
      console.log('⚠ Skipping admin reviews/audit seed — no admin user found');
      return;
    }

    // ─── PENDING REVIEWS ─────────────────────────────────────
    const [existingPending] = await sequelize.query(
      `SELECT COUNT(*)::int AS count FROM reviews
       WHERE status = 'PENDING' AND "deletedAt" IS NULL`,
    );
    const pendingCount = existingPending[0]?.count ?? 0;

    if (pendingCount < 12) {
      const [candidates] = await sequelize.query(
        `SELECT oi.id AS "orderItemId", oi."productName", so."orderId", o."userId", pv."productId"
         FROM order_items oi
         INNER JOIN sub_orders so ON so.id = oi."subOrderId"
         INNER JOIN orders o ON o.id = so."orderId"
         INNER JOIN product_variants pv ON pv.id = oi."variantId"
         WHERE o.status = 'DELIVERED'
           AND oi."deletedAt" IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM reviews r
             WHERE r."orderItemId" = oi.id AND r."deletedAt" IS NULL
           )
         ORDER BY o."createdAt" DESC
         LIMIT 20`,
      );

      const reviewsToInsert = [];
      for (const row of candidates) {
        if (reviewsToInsert.length >= 15) break;
        const rating = 3 + (reviewsToInsert.length % 3);
        reviewsToInsert.push({
          id: randomUUID(),
          productId: row.productId,
          userId: row.userId,
          orderItemId: row.orderItemId,
          rating,
          title: PENDING_REVIEW_MARKER,
          body: 'Seeded pending review for admin moderation testing. Product arrived as described.',
          status: 'PENDING',
          helpfulCount: 0,
          unhelpfulCount: 0,
          createdAt: new Date(now.getTime() - reviewsToInsert.length * 3600_000),
          updatedAt: now,
        });
      }

      if (reviewsToInsert.length) {
        await queryInterface.bulkInsert('reviews', reviewsToInsert);
        console.log(`✓ Seeded ${reviewsToInsert.length} PENDING reviews`);
      } else {
        // Fallback: flip existing APPROVED reviews to PENDING for moderation testing
        const needed = 12 - pendingCount;
        await sequelize.query(
          `UPDATE reviews
           SET status = 'PENDING',
               title = :title,
               "updatedAt" = :now
           WHERE id IN (
             SELECT id FROM reviews
             WHERE status = 'APPROVED' AND "deletedAt" IS NULL
             ORDER BY "createdAt" DESC
             LIMIT :limit
           )`,
          { replacements: { title: PENDING_REVIEW_MARKER, now, limit: needed } },
        );
        console.log(`✓ Marked up to ${needed} APPROVED reviews as PENDING for moderation`);
      }
    } else {
      console.log('✓ PENDING reviews already present — skipped');
    }

    // ─── AUDIT LOGS ──────────────────────────────────────────
    const [existingAudit] = await sequelize.query(
      `SELECT COUNT(*)::int AS count FROM audit_logs
       WHERE action = :action AND "deletedAt" IS NULL`,
      { replacements: { action: AUDIT_SEED_ACTION } },
    );

    if ((existingAudit[0]?.count ?? 0) === 0) {
      const productIds = products.map((p) => p.id);
      const vendorIds = vendors.map((v) => v.id);
      const customerIds = customers.map((c) => c.id);
      const adminIds = admins.map((a) => a.id);

      const fixtures = [
        { action: 'VENDOR_APPROVE', entityType: 'Vendor', entityId: vendorIds[0], meta: { source: 'seed' } },
        { action: 'VENDOR_SUSPEND', entityType: 'Vendor', entityId: vendorIds[1] || vendorIds[0], meta: { reason: 'seed fixture' } },
        { action: 'PRODUCT_APPROVE', entityType: 'Product', entityId: productIds[0], meta: { source: 'seed' } },
        { action: 'PRODUCT_REJECT', entityType: 'Product', entityId: productIds[1] || productIds[0], meta: { note: 'seed rejection' } },
        { action: 'PRODUCT_ARCHIVE', entityType: 'Product', entityId: productIds[2] || productIds[0], meta: {} },
        { action: 'USER_STATUS_UPDATE', entityType: 'User', entityId: customerIds[0], meta: { status: 'BLOCKED' } },
        { action: 'USER_STATUS_UPDATE', entityType: 'User', entityId: customerIds[1] || customerIds[0], meta: { status: 'ACTIVE' } },
        { action: 'REVIEW_APPROVE', entityType: 'Review', entityId: productIds[0], meta: { note: 'entityId placeholder product for seed' } },
        { action: 'REVIEW_REJECT', entityType: 'Review', entityId: productIds[1] || productIds[0], meta: {} },
        { action: 'ORDER_CONFIRM', entityType: 'Order', entityId: productIds[0], meta: { source: 'seed' } },
        { action: 'TAX_RULE_CREATE', entityType: 'TaxRule', entityId: productIds[0], meta: { gstPercentage: 18 } },
        { action: 'SHIPPING_ZONE_CREATE', entityType: 'ShippingZone', entityId: productIds[0], meta: { name: 'Seed zone' } },
        { action: 'COUPON_CREATE', entityType: 'Coupon', entityId: productIds[0], meta: { code: 'SEEDTEST' } },
        { action: 'PAYOUT_PROCESS', entityType: 'Payout', entityId: vendorIds[0], meta: { batch: true } },
        { action: 'SETTINGS_UPDATE', entityType: 'PlatformSetting', entityId: productIds[0], meta: { key: 'platform' } },
        { action: AUDIT_SEED_ACTION, entityType: 'System', entityId: actorId, meta: { purpose: 'admin audit table fixture marker' } },
      ].filter((row) => row.entityId);

      const logs = fixtures.map((fixture, index) => ({
        id: randomUUID(),
        actorId: adminIds[index % adminIds.length] || actorId,
        action: fixture.action,
        entityType: fixture.entityType,
        entityId: fixture.entityId,
        metadata: JSON.stringify(fixture.meta ?? {}),
        createdBy: actorId,
        updatedBy: null,
        deletedBy: null,
        createdAt: new Date(now.getTime() - (fixtures.length - index) * 7200_000),
        updatedAt: now,
        deletedAt: null,
      }));

      if (logs.length) {
        await queryInterface.bulkInsert('audit_logs', logs);
        console.log(`✓ Seeded ${logs.length} audit log entries`);
      }
    } else {
      console.log('✓ Audit seed fixtures already present — skipped');
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(
      `DELETE FROM reviews WHERE title = :title AND status = 'PENDING'`,
      { replacements: { title: PENDING_REVIEW_MARKER } },
    );
    await sequelize.query(
      `DELETE FROM audit_logs WHERE action = :action OR metadata->>'purpose' = 'admin audit table fixture marker'`,
      { replacements: { action: AUDIT_SEED_ACTION } },
    );
  },
};
