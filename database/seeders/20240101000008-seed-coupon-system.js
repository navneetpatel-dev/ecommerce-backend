'use strict';

const { randomUUID } = require('crypto');

/**
 * Idempotent coupon-system seed (`cs-coupon-*` codes):
 * - Platform PERCENTAGE coupon (discountBearer PLATFORM)
 * - Vendor-scoped FLAT coupon (discountBearer VENDOR) for an approved vendor
 * - One CouponBatch with 3 generated single-use codes
 */

async function findId(queryInterface, sql, replacements = {}) {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows[0]?.id ?? null;
}

async function ensureCoupon(queryInterface, row) {
  const existingId = await findId(
    queryInterface,
    `SELECT id FROM coupons WHERE code = :code LIMIT 1`,
    { code: row.code },
  );
  if (existingId) return existingId;

  await queryInterface.bulkInsert('coupons', [row]);
  return row.id;
}

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const endDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const adminId = await findId(
      queryInterface,
      `SELECT id FROM users WHERE email = 'admin@ecommerce.com' LIMIT 1`,
    );
    if (!adminId) {
      console.log('skip coupon seed — no admin user');
      return;
    }

    const vendorId = await findId(
      queryInterface,
      `SELECT id FROM vendors WHERE status = 'APPROVED' ORDER BY "createdAt" ASC LIMIT 1`,
    );

    await ensureCoupon(queryInterface, {
      id: randomUUID(),
      code: 'CS-COUPON-PLATFORM-10',
      type: 'PERCENTAGE',
      value: 10,
      maxDiscountCap: 500,
      minOrderValue: 100,
      minQuantity: null,
      applicableScope: JSON.stringify({ type: 'all', ids: [] }),
      excludedItems: JSON.stringify({ productIds: [], categoryIds: [] }),
      userRestriction: JSON.stringify({ type: 'all' }),
      usageLimitTotal: 1000,
      usageLimitPerUser: 5,
      usedCount: 0,
      startDate,
      endDate,
      stackable: false,
      priority: 10,
      status: 'ACTIVE',
      discountBearer: 'PLATFORM',
      batchId: null,
      createdById: adminId,
      updatedBy: null,
      deletedBy: null,
      vendorId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    if (vendorId) {
      await ensureCoupon(queryInterface, {
        id: randomUUID(),
        code: 'CS-COUPON-VENDOR-FLAT',
        type: 'FLAT',
        value: 50,
        maxDiscountCap: null,
        minOrderValue: 200,
        minQuantity: null,
        applicableScope: JSON.stringify({ type: 'vendor', ids: [vendorId] }),
        excludedItems: JSON.stringify({ productIds: [], categoryIds: [] }),
        userRestriction: JSON.stringify({ type: 'all' }),
        usageLimitTotal: 500,
        usageLimitPerUser: 3,
        usedCount: 0,
        startDate,
        endDate,
        stackable: false,
        priority: 5,
        status: 'ACTIVE',
        discountBearer: 'VENDOR',
        batchId: null,
        createdById: adminId,
        updatedBy: null,
        deletedBy: null,
        vendorId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }

    let batchId = await findId(
      queryInterface,
      `SELECT id FROM coupon_batches WHERE name = 'cs-coupon-batch-welcome' LIMIT 1`,
    );

    if (!batchId) {
      batchId = randomUUID();
      await queryInterface.bulkInsert('coupon_batches', [
        {
          id: batchId,
          name: 'cs-coupon-batch-welcome',
          templateCouponConfig: JSON.stringify({
            type: 'FLAT',
            value: 25,
            discountBearer: 'PLATFORM',
            minOrderValue: 150,
          }),
          generatedCount: 3,
          createdById: adminId,
          createdBy: adminId,
          updatedBy: null,
          deletedBy: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
      ]);
    }

    const batchCodes = ['CS-COUPON-BATCH-01', 'CS-COUPON-BATCH-02', 'CS-COUPON-BATCH-03'];
    for (const code of batchCodes) {
      await ensureCoupon(queryInterface, {
        id: randomUUID(),
        code,
        type: 'FLAT',
        value: 25,
        maxDiscountCap: null,
        minOrderValue: 150,
        minQuantity: null,
        applicableScope: JSON.stringify({ type: 'all', ids: [] }),
        excludedItems: JSON.stringify({ productIds: [], categoryIds: [] }),
        userRestriction: JSON.stringify({ type: 'all' }),
        usageLimitTotal: 1,
        usageLimitPerUser: 1,
        usedCount: 0,
        startDate,
        endDate,
        stackable: false,
        priority: 1,
        status: 'ACTIVE',
        discountBearer: 'PLATFORM',
        batchId,
        createdById: adminId,
        updatedBy: null,
        deletedBy: null,
        vendorId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }

    console.log('✓ Coupon system seed (cs-coupon-*)');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM coupons WHERE code LIKE 'CS-COUPON-%'`,
    );
    await queryInterface.sequelize.query(
      `DELETE FROM coupon_batches WHERE name = 'cs-coupon-batch-welcome'`,
    );
  },
};
