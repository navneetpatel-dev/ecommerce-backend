'use strict';

/**
 * A product's listed price (basePrice) is its lowest variant price: the card, search,
 * price filter and sort showed prices no variant sold at. Align existing products;
 * the app keeps them in step from here on.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE products p
      SET "basePrice" = v.lowest, "updatedAt" = NOW()
      FROM (
        SELECT "productId", MIN(price) AS lowest
        FROM product_variants
        WHERE "deletedAt" IS NULL
        GROUP BY "productId"
      ) v
      WHERE v."productId" = p.id
        AND p."basePrice" <> v.lowest
    `);
  },

  async down() {
    // Data alignment only.
  },
};
