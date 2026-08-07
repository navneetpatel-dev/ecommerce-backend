'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('coupons', 'config', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('coupons', 'config');
  },
};
