'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('push_subscriptions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      endpoint: { type: Sequelize.TEXT, allowNull: false },
      p256dhKey: { type: Sequelize.TEXT, allowNull: false },
      authKey: { type: Sequelize.TEXT, allowNull: false },
      userAgent: { type: Sequelize.STRING(512), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('push_subscriptions', ['endpoint'], { unique: true });
    await queryInterface.addIndex('push_subscriptions', ['userId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('push_subscriptions');
  },
};
