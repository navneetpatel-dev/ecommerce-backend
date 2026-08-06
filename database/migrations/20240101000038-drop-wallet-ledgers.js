'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.dropTable('wallet_ledgers').catch(() => {});
    // Drop enum type if Postgres left it behind
    try {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_wallet_ledgers_type";',
      );
    } catch {
      // ignore
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.createTable('wallet_ledgers', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      type: { type: Sequelize.ENUM('CREDIT', 'DEBIT'), allowNull: false },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      balanceAfter: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      referenceType: { type: Sequelize.STRING, allowNull: true },
      referenceId: { type: Sequelize.UUID, allowNull: true },
      description: { type: Sequelize.STRING, allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
};
