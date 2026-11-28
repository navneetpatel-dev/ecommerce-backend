'use strict';

/**
 * Indexes on the foreign keys the product, search and order queries join on. Without them
 * every search result scanned all variants and images: with 6,000 products, a search took
 * over a second.
 */
const INDEXES = [
  ['product_variants', 'productId', 'product_variants_product_id_idx'],
  ['product_images', 'productId', 'product_images_product_id_idx'],
  ['order_items', 'subOrderId', 'order_items_sub_order_id_idx'],
  ['order_items', 'variantId', 'order_items_variant_id_idx'],
  ['orders', 'userId', 'orders_user_id_idx'],
];

module.exports = {
  async up(queryInterface) {
    for (const [table, column, name] of INDEXES) {
      await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} ("${column}")`);
    }
  },

  async down(queryInterface) {
    for (const [, , name] of INDEXES) {
      await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${name}`);
    }
  },
};
