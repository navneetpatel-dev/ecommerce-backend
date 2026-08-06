'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('webhook_events', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      provider: { type: Sequelize.STRING, allowNull: false },
      eventId: { type: Sequelize.STRING, allowNull: false },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('webhook_events', ['provider', 'eventId'], {
      unique: true,
      name: 'webhook_events_provider_event_id_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('webhook_events');
  },
};
