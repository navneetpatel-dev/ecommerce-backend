'use strict';

/**
 * Real earnings/payout system for delivery agents, mirroring the vendor
 * Payout/CommissionLedger pattern (batch process → mark paid/failed → retry)
 * without the GST/TDS marketplace-commission machinery, which is specific to
 * vendor settlements and does not apply to a flat delivery-task wage.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('delivery_agents', 'bankDetails', {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.createTable('delivery_agent_payouts', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      deliveryAgentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'delivery_agents', key: 'id' },
        onDelete: 'RESTRICT',
      },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      periodStart: { type: Sequelize.DATE, allowNull: false },
      periodEnd: { type: Sequelize.DATE, allowNull: false },
      status: {
        type: Sequelize.ENUM('PENDING', 'PAID', 'FAILED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      paymentMethod: {
        type: Sequelize.ENUM('NEFT', 'IMPS', 'UPI', 'RTGS', 'CHEQUE', 'CASH', 'OTHER'),
        allowNull: true,
      },
      paymentReferenceNumber: { type: Sequelize.STRING, allowNull: true },
      proofOfPaymentUrl: { type: Sequelize.STRING, allowNull: true },
      remarks: { type: Sequelize.TEXT, allowNull: true },
      failureReason: { type: Sequelize.TEXT, allowNull: true },
      paidByAdminId: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
      paidAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('delivery_agent_payouts', ['deliveryAgentId']);
    await queryInterface.addIndex('delivery_agent_payouts', ['status']);

    await queryInterface.createTable('delivery_agent_earnings', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      deliveryAgentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'delivery_agents', key: 'id' },
        onDelete: 'CASCADE',
      },
      sourceType: { type: Sequelize.ENUM('DELIVERY', 'PICKUP'), allowNull: false },
      sourceId: { type: Sequelize.UUID, allowNull: false },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      status: {
        type: Sequelize.ENUM('PENDING', 'SETTLED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      payoutId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'delivery_agent_payouts', key: 'id' },
        onDelete: 'SET NULL',
      },
      earnedAt: { type: Sequelize.DATE, allowNull: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('delivery_agent_earnings', ['deliveryAgentId']);
    await queryInterface.addIndex('delivery_agent_earnings', ['status']);
    await queryInterface.addIndex('delivery_agent_earnings', ['payoutId']);
    // One earning per completed task — confirmDelivery/confirmPickup are themselves
    // idempotent-guarded, this is the DB-level backstop against double-crediting.
    await queryInterface.addConstraint('delivery_agent_earnings', {
      fields: ['sourceType', 'sourceId'],
      type: 'unique',
      name: 'delivery_agent_earnings_source_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('delivery_agent_earnings');
    await queryInterface.dropTable('delivery_agent_payouts');
    await queryInterface.removeColumn('delivery_agents', 'bankDetails');
  },
};
