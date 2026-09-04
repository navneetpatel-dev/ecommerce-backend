'use strict';

/**
 * Closes the gaps in DELIVERY_MODULE_GAP_ANALYSIS.md:
 * failed-attempt reasons, COD cash-on-delivery tracking, RTO lifecycle,
 * agent live-location beaconing, customer redelivery rescheduling, and
 * per-address delivery instructions.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('shipments', 'failureReason', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('shipments', 'failedAttemptCount', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('shipments', 'lastFailedAttemptAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('shipments', 'codAmount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('shipments', 'codCollected', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('shipments', 'codCollectedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('shipments', 'preferredRedeliverySlot', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        ALTER TYPE "enum_shipments_status" ADD VALUE IF NOT EXISTS 'RTO_INITIATED';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
      END $$;
    `);
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        ALTER TYPE "enum_shipments_status" ADD VALUE IF NOT EXISTS 'RTO_DELIVERED';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
      END $$;
    `);

    await queryInterface.addColumn('delivery_agents', 'lastLat', {
      type: Sequelize.DECIMAL(9, 6),
      allowNull: true,
    });
    await queryInterface.addColumn('delivery_agents', 'lastLng', {
      type: Sequelize.DECIMAL(9, 6),
      allowNull: true,
    });
    await queryInterface.addColumn('delivery_agents', 'locationUpdatedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('addresses', 'deliveryInstructions', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('addresses', 'deliveryInstructions');
    await queryInterface.removeColumn('delivery_agents', 'locationUpdatedAt');
    await queryInterface.removeColumn('delivery_agents', 'lastLng');
    await queryInterface.removeColumn('delivery_agents', 'lastLat');
    // Postgres cannot remove enum values safely; RTO_INITIATED/RTO_DELIVERED are left in place.
    await queryInterface.removeColumn('shipments', 'preferredRedeliverySlot');
    await queryInterface.removeColumn('shipments', 'codCollectedAt');
    await queryInterface.removeColumn('shipments', 'codCollected');
    await queryInterface.removeColumn('shipments', 'codAmount');
    await queryInterface.removeColumn('shipments', 'lastFailedAttemptAt');
    await queryInterface.removeColumn('shipments', 'failedAttemptCount');
    await queryInterface.removeColumn('shipments', 'failureReason');
  },
};
