'use strict';

/**
 * A coupon's payer now follows its owner: a vendor's coupon is vendor-funded, a platform
 * coupon platform-funded. Rows that broke this were created through the API, and past
 * orders on them may have charged the wrong party. Those orders stay frozen: they are
 * logged here for finance to reconcile by hand. Not reversible: the old values were wrong.
 */
module.exports = {
  async up(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(`
      SELECT c.id, c.code, c."vendorId", c."discountBearer", COUNT(cu.id)::int AS "orders"
      FROM coupons c
      LEFT JOIN coupon_usages cu ON cu."couponId" = c.id AND cu."deletedAt" IS NULL
      WHERE (c."vendorId" IS NOT NULL AND c."discountBearer" = 'PLATFORM')
         OR (c."vendorId" IS NULL AND c."discountBearer" = 'VENDOR')
      GROUP BY c.id
    `);
    if (rows.length > 0) {
      console.warn(`[coupon-bearer] corrected ${rows.length} coupon(s); reconcile their past orders:`);
      console.warn(JSON.stringify(rows, null, 2));
    }
    await queryInterface.sequelize.query(`
      UPDATE coupons
      SET "discountBearer" = (CASE WHEN "vendorId" IS NULL THEN 'PLATFORM' ELSE 'VENDOR' END)::"enum_coupons_discountBearer"
      WHERE ("vendorId" IS NOT NULL AND "discountBearer" = 'PLATFORM')
         OR ("vendorId" IS NULL AND "discountBearer" = 'VENDOR')
    `);
  },

  async down() {},
};
