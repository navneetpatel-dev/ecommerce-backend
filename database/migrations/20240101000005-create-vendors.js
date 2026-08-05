'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vendors', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      businessName: { type: Sequelize.STRING, allowNull: false },
      slug: { type: Sequelize.STRING, unique: true, allowNull: false },
      gstNumber: { type: Sequelize.STRING, allowNull: true },
      bankDetails: { type: Sequelize.JSONB, allowNull: false },
      logoUrl: { type: Sequelize.STRING, allowNull: true },
      bannerUrl: { type: Sequelize.STRING, allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'), defaultValue: 'PENDING' },
      commissionRate: { type: Sequelize.DECIMAL(5, 2), defaultValue: 10.0 },
      performanceScore: { type: Sequelize.DECIMAL(5, 2), defaultValue: 0 },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('vendors'); },
};
