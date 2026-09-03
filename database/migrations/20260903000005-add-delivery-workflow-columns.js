'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'deliveryAgentId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'delivery_agents', key: 'id' },
      onDelete: 'SET NULL',
    });

    await queryInterface.addColumn('shipments', 'deliveryAgentId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'delivery_agents', key: 'id' },
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('shipments', 'assignedAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('shipments', 'proofOfDeliveryUrl', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('shipments', 'deliveryOtpVerifiedAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addIndex('shipments', ['deliveryAgentId']);

    await queryInterface.addColumn('return_requests', 'deliveryAgentId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'delivery_agents', key: 'id' },
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('return_requests', 'pickupOtpVerifiedAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('return_requests', 'pickupFailureReason', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('return_requests', 'type', {
      type: Sequelize.ENUM('REFUND', 'EXCHANGE'),
      allowNull: false,
      defaultValue: 'REFUND',
    });
    await queryInterface.addColumn('return_requests', 'replacementDeliveredAt', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('return_requests', 'replacementProofUrl', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addIndex('return_requests', ['deliveryAgentId']);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('return_requests', 'replacementProofUrl');
    await queryInterface.removeColumn('return_requests', 'replacementDeliveredAt');
    await queryInterface.removeColumn('return_requests', 'type');
    await queryInterface.removeColumn('return_requests', 'pickupFailureReason');
    await queryInterface.removeColumn('return_requests', 'pickupOtpVerifiedAt');
    await queryInterface.removeColumn('return_requests', 'deliveryAgentId');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_return_requests_type";');
    await queryInterface.removeColumn('shipments', 'deliveryOtpVerifiedAt');
    await queryInterface.removeColumn('shipments', 'proofOfDeliveryUrl');
    await queryInterface.removeColumn('shipments', 'assignedAt');
    await queryInterface.removeColumn('shipments', 'deliveryAgentId');
    await queryInterface.removeColumn('users', 'deliveryAgentId');
  },
};
