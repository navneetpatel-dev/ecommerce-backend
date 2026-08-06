'use strict';

/** Align `orders` with the Order model — older DBs used migration 015 without audit/paranoid cols. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('orders');

    if (!table.createdBy) {
      await queryInterface.addColumn('orders', 'createdBy', {
        type: Sequelize.UUID,
        allowNull: true,
      });
    }
    if (!table.updatedBy) {
      await queryInterface.addColumn('orders', 'updatedBy', {
        type: Sequelize.UUID,
        allowNull: true,
      });
    }
    if (!table.deletedBy) {
      await queryInterface.addColumn('orders', 'deletedBy', {
        type: Sequelize.UUID,
        allowNull: true,
      });
    }
    if (!table.deletedAt) {
      await queryInterface.addColumn('orders', 'deletedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('orders');
    if (table.deletedAt) await queryInterface.removeColumn('orders', 'deletedAt');
    if (table.deletedBy) await queryInterface.removeColumn('orders', 'deletedBy');
    if (table.updatedBy) await queryInterface.removeColumn('orders', 'updatedBy');
    if (table.createdBy) await queryInterface.removeColumn('orders', 'createdBy');
  },
};
