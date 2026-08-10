'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vendor_categories', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      vendorId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'vendors', key: 'id' },
        onDelete: 'CASCADE',
      },
      categoryId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'categories', key: 'id' },
        onDelete: 'CASCADE',
      },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('vendor_categories', ['vendorId', 'categoryId'], {
      unique: true,
      name: 'vendor_categories_vendor_category_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('vendor_categories');
  },
};
