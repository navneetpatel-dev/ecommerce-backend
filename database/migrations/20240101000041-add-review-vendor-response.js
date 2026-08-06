'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('reviews', 'vendorResponse', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('reviews', 'vendorRespondedAt', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('reviews', 'vendorRespondedAt');
    await queryInterface.removeColumn('reviews', 'vendorResponse');
  },
};
