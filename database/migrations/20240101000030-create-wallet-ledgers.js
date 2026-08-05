'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wallet_ledgers', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'RESTRICT' },
      type: { type: Sequelize.ENUM('CREDIT', 'DEBIT'), allowNull: false },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      balanceAfter: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      referenceType: { type: Sequelize.STRING, allowNull: false },
      referenceId: { type: Sequelize.UUID, allowNull: false },
      description: { type: Sequelize.STRING, allowNull: false },
      expiresAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('wallet_ledgers'); },
};
