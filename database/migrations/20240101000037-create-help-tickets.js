'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('help_tickets', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      name: { type: Sequelize.STRING(120), allowNull: false },
      email: { type: Sequelize.STRING(255), allowNull: false },
      topic: {
        type: Sequelize.ENUM(
          'ORDERS',
          'SHIPPING',
          'RETURNS',
          'PAYMENTS',
          'ACCOUNT',
          'PRODUCTS',
          'SELLERS',
          'OTHER'
        ),
        allowNull: false,
        defaultValue: 'OTHER',
      },
      subject: { type: Sequelize.STRING(200), allowNull: false },
      message: { type: Sequelize.TEXT, allowNull: false },
      orderId: { type: Sequelize.UUID, allowNull: true },
      status: {
        type: Sequelize.ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'),
        allowNull: false,
        defaultValue: 'OPEN',
      },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('help_tickets', ['email']);
    await queryInterface.addIndex('help_tickets', ['status']);
    await queryInterface.addIndex('help_tickets', ['topic']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('help_tickets');
  },
};
