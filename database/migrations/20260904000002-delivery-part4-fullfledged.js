'use strict';

/**
 * Schema for the full-fledged Part 4 delivery features:
 * - Vendor handover OTP confirmation for RTO parcels (otp_codes purpose + audit column).
 * - Agent shift-end cash deposit reconciliation (delivery_cash_deposits table).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        ALTER TYPE "enum_otp_codes_purpose" ADD VALUE IF NOT EXISTS 'RTO_HANDOVER_CONFIRMATION';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
      END $$;
    `);

    await queryInterface.addColumn('shipments', 'rtoHandoverOtpVerifiedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('shipments', 'rtoConfirmedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.createTable('delivery_cash_deposits', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      deliveryAgentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'delivery_agents', key: 'id' },
        onDelete: 'CASCADE',
      },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      expectedAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      status: {
        type: Sequelize.ENUM('PENDING', 'VERIFIED', 'REJECTED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      note: { type: Sequelize.TEXT, allowNull: true },
      rejectionReason: { type: Sequelize.TEXT, allowNull: true },
      verifiedById: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
      verifiedAt: { type: Sequelize.DATE, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
    await queryInterface.addIndex('delivery_cash_deposits', ['deliveryAgentId']);
    await queryInterface.addIndex('delivery_cash_deposits', ['status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('delivery_cash_deposits');
    await queryInterface.removeColumn('shipments', 'rtoConfirmedAt');
    await queryInterface.removeColumn('shipments', 'rtoHandoverOtpVerifiedAt');
    // Postgres cannot remove enum values safely; RTO_HANDOVER_CONFIRMATION is left in place.
  },
};
