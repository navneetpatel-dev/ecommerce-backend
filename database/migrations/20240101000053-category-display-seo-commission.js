'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('categories', 'displayOrder', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('categories', 'seoTitle', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('categories', 'seoDescription', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('categories', 'commissionRate', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('categories', 'commissionRate');
    await queryInterface.removeColumn('categories', 'seoDescription');
    await queryInterface.removeColumn('categories', 'seoTitle');
    await queryInterface.removeColumn('categories', 'displayOrder');
  },
};
