'use strict';

const { refreshAboveMrpFlags } = require('../seeders/lib/product-display-price');

/**
 * The MRP includes GST, so a piece whose price with GST is above it may not be sold. These flags
 * say which: `product_variants.aboveMrp`, and `products.aboveMrp` when every price a product
 * sells at is above (it is then hidden from the shop). Existing rows are marked here, so listings
 * already above their MRP stop selling when this runs: check them first with
 * `scripts/fix-above-mrp.ts`. Safe to run again.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS "aboveMrp" BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS "aboveMrp" BOOLEAN NOT NULL DEFAULT false`,
    );
    await refreshAboveMrpFlags(queryInterface);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE product_variants DROP COLUMN IF EXISTS "aboveMrp"`);
    await queryInterface.sequelize.query(`ALTER TABLE products DROP COLUMN IF EXISTS "aboveMrp"`);
  },
};
