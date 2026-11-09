'use strict';

/**
 * Platform cashback offers: cashback the platform funds and applies at checkout without a
 * coupon code (e.g. 5% back up to ₹100 on orders above ₹999), optionally only for some
 * categories or payment methods. The order records which offer it got.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'cashback_offers',
        {
          id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true },
          name: { type: Sequelize.STRING(120), allowNull: false },
          percent: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
          maxCashback: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
          minOrderValue: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
          categoryIds: { type: Sequelize.ARRAY(Sequelize.UUID), allowNull: false, defaultValue: [] },
          paymentMethods: { type: Sequelize.ARRAY(Sequelize.STRING(20)), allowNull: false, defaultValue: [] },
          startsAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          endsAt: { type: Sequelize.DATE, allowNull: true },
          isActive: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          createdBy: { type: Sequelize.UUID, allowNull: true },
          updatedBy: { type: Sequelize.UUID, allowNull: true },
          createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          deletedAt: { type: Sequelize.DATE, allowNull: true },
        },
        { transaction },
      );
      await queryInterface.addIndex('cashback_offers', ['isActive', 'startsAt', 'endsAt'], {
        name: 'cashback_offers_live',
        transaction,
      });
      await queryInterface.addColumn(
        'orders',
        'cashbackOfferId',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'cashback_offers', key: 'id' },
          onDelete: 'SET NULL',
        },
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeColumn('orders', 'cashbackOfferId', { transaction });
      await queryInterface.dropTable('cashback_offers', { transaction });
    });
  },
};
