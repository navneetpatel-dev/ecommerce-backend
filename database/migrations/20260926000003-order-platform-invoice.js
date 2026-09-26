'use strict';

/**
 * The gift-wrap fee is the platform's own service, so it carries GST (18%, included in
 * the fee) and needs the platform's tax invoice. Store that invoice on the order, frozen
 * at checkout: number, place-of-supply split and lines in paise. NULL on orders without
 * a platform fee, and on orders placed before this column.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('orders', 'platformInvoiceSnapshot', {
      type: Sequelize.JSONB,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('orders', 'platformInvoiceSnapshot');
  },
};
