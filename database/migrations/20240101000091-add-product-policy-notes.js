'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'deliveryNote', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'returnNote', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('products', 'returnNote');
    await queryInterface.removeColumn('products', 'deliveryNote');
  },
};
