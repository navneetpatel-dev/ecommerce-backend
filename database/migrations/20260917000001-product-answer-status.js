'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('product_answers');
    if (!table.status) {
      await queryInterface.addColumn('product_answers', 'status', {
        type: Sequelize.ENUM('PENDING', 'PUBLISHED', 'REJECTED'),
        allowNull: false,
        defaultValue: 'PENDING',
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('product_answers');
    if (table.status) {
      await queryInterface.removeColumn('product_answers', 'status');
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_product_answers_status";');
  },
};
