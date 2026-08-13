'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'compareAtPrice', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'brand', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'specs', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {},
    });
    await queryInterface.addColumn('products', 'highlights', {
      type: Sequelize.ARRAY(Sequelize.TEXT),
      allowNull: false,
      defaultValue: [],
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('products', 'highlights');
    await queryInterface.removeColumn('products', 'specs');
    await queryInterface.removeColumn('products', 'brand');
    await queryInterface.removeColumn('products', 'compareAtPrice');
  },
};
