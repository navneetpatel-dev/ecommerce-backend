'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('categories', 'status', {
      type: Sequelize.ENUM('ACTIVE', 'ARCHIVED'),
      allowNull: false,
      defaultValue: 'ACTIVE',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('categories', 'status');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_categories_status";');
  },
};
