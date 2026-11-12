'use strict';

/**
 * Product lists carry a review count per product (a correlated subquery). With no
 * index on reviews."productId", Postgres scanned every review for every product it
 * walked past, so deep pages took 15–18 s (page 453 of /api/products, or a page past
 * the end, which the storefront showed as an endless "Updating…"). The count filters
 * on status and live rows, so the index covers exactly that.
 */
const NAME = 'reviews_product_id_status_live';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS "${NAME}" ON reviews ("productId", status) WHERE "deletedAt" IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${NAME}"`);
  },
};
