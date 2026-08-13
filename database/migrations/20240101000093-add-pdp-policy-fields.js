'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('categories', 'returnWindowDays', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('categories', 'codEnabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('categories', 'defaultWarrantyMonths', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('categories', 'defaultWarrantyType', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('products', 'warrantyMonths', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'warrantyType', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'hsnCode', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'seoTitle', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'seoDescription', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'videoUrl', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'sizeChartUrl', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('products', 'codEnabled', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
    });

    await queryInterface.addColumn('vendors', 'codEnabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });

    await queryInterface.addColumn('product_images', 'variantId', {
      type: Sequelize.UUID,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('product_images', 'variantId');
    await queryInterface.removeColumn('vendors', 'codEnabled');
    await queryInterface.removeColumn('products', 'codEnabled');
    await queryInterface.removeColumn('products', 'sizeChartUrl');
    await queryInterface.removeColumn('products', 'videoUrl');
    await queryInterface.removeColumn('products', 'seoDescription');
    await queryInterface.removeColumn('products', 'seoTitle');
    await queryInterface.removeColumn('products', 'hsnCode');
    await queryInterface.removeColumn('products', 'warrantyType');
    await queryInterface.removeColumn('products', 'warrantyMonths');
    await queryInterface.removeColumn('categories', 'defaultWarrantyType');
    await queryInterface.removeColumn('categories', 'defaultWarrantyMonths');
    await queryInterface.removeColumn('categories', 'codEnabled');
    await queryInterface.removeColumn('categories', 'returnWindowDays');
  },
};
