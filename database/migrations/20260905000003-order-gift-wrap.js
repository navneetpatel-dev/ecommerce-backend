'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orders');
    if (!table.giftWrap) {
      await queryInterface.addColumn('orders', 'giftWrap', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }
    if (!table.giftMessage) {
      await queryInterface.addColumn('orders', 'giftMessage', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
    if (!table.giftWrapFeeAmount) {
      await queryInterface.addColumn('orders', 'giftWrapFeeAmount', {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('orders');
    if (table.giftWrapFeeAmount) {
      await queryInterface.removeColumn('orders', 'giftWrapFeeAmount');
    }
    if (table.giftMessage) {
      await queryInterface.removeColumn('orders', 'giftMessage');
    }
    if (table.giftWrap) {
      await queryInterface.removeColumn('orders', 'giftWrap');
    }
  },
};
