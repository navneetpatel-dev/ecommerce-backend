'use strict';

/**
 * One live return request per order line, as returns.create already checks. That check
 * raced: two requests at once could both pass it. The service now locks the line; this
 * index is the database's guarantee.
 */
const INDEX = 'return_requests_order_item_live_unique';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX "${INDEX}" ON return_requests ("orderItemId") WHERE "deletedAt" IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${INDEX}"`);
  },
};
