'use strict';

/** Optional post-delivery customer rating — one per shipment, feeds the agent's average score. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('delivery_ratings', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      shipmentId: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'shipments', key: 'id' },
        onDelete: 'CASCADE',
      },
      userId: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
      deliveryAgentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'delivery_agents', key: 'id' },
        onDelete: 'CASCADE',
      },
      rating: { type: Sequelize.INTEGER, allowNull: false },
      comment: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('delivery_ratings', ['deliveryAgentId']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('delivery_ratings');
  },
};
