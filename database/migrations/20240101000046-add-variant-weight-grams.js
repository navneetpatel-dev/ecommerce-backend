'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('product_variants', 'weightGrams', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 500,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('product_variants', 'weightGrams');
  },
};
