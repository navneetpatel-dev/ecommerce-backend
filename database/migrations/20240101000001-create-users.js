'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      email: { type: Sequelize.STRING, unique: true, allowNull: false },
      passwordHash: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      phone: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.ENUM('ACTIVE', 'BLOCKED'), defaultValue: 'ACTIVE' },
      roleId: { type: Sequelize.UUID, allowNull: false },
      vendorId: { type: Sequelize.UUID, allowNull: true },
      emailVerified: { type: Sequelize.BOOLEAN, defaultValue: false },
      emailMarketingConsent: { type: Sequelize.BOOLEAN, defaultValue: false },
      emailSuppressed: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('users'); },
};
