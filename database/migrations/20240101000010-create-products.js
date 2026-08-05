'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('products', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      vendorId: { type: Sequelize.UUID, allowNull: true, references: { model: 'vendors', key: 'id' }, onDelete: 'SET NULL' },
      categoryId: { type: Sequelize.UUID, allowNull: false, references: { model: 'categories', key: 'id' }, onDelete: 'RESTRICT' },
      name: { type: Sequelize.STRING, allowNull: false },
      slug: { type: Sequelize.STRING, unique: true, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      basePrice: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      status: { type: Sequelize.ENUM('DRAFT', 'PENDING_APPROVAL', 'LIVE', 'REJECTED', 'ARCHIVED'), defaultValue: 'DRAFT' },
      approvedById: { type: Sequelize.UUID, allowNull: true },
      rejectionNote: { type: Sequelize.TEXT, allowNull: true },
      tags: { type: Sequelize.ARRAY(Sequelize.STRING), defaultValue: [] },
      avgRating: { type: Sequelize.DECIMAL(3, 2), defaultValue: 0 },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('products'); },
};
