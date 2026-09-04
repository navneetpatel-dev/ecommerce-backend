'use strict';

/**
 * Full per-attempt failure history for a shipment. Previously `Shipment`
 * only kept the latest `failureReason`/`failedAttemptCount` — this table
 * records every attempt (note + optional photo) so agents, customers, and
 * support can see the whole story, not just the most recent line.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('shipment_attempts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      shipmentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'shipments', key: 'id' },
        onDelete: 'CASCADE',
      },
      attemptNumber: { type: Sequelize.INTEGER, allowNull: false },
      note: { type: Sequelize.TEXT, allowNull: false },
      photoUrl: { type: Sequelize.STRING, allowNull: true },
      attemptedAt: { type: Sequelize.DATE, allowNull: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('shipment_attempts', ['shipmentId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('shipment_attempts');
  },
};
