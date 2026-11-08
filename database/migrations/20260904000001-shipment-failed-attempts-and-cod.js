'use strict';

/**
 * Failed delivery attempts (reason, count, last attempt), cash on delivery tracking, the
 * customer's preferred redelivery slot, the return-to-origin (RTO) statuses, and
 * per-address delivery instructions. Safe to run again: each change is made only when
 * missing.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE shipments
        ADD COLUMN IF NOT EXISTS "failureReason" TEXT,
        ADD COLUMN IF NOT EXISTS "failedAttemptCount" INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "lastFailedAttemptAt" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "codAmount" DECIMAL(10, 2),
        ADD COLUMN IF NOT EXISTS "codCollected" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "codCollectedAt" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "preferredRedeliverySlot" VARCHAR(64);
    `);
    for (const status of ['RTO_INITIATED', 'RTO_DELIVERED']) {
      await queryInterface.sequelize.query(`
        DO $$ BEGIN
          ALTER TYPE "enum_shipments_status" ADD VALUE IF NOT EXISTS '${status}';
        EXCEPTION
          WHEN duplicate_object THEN NULL;
          WHEN undefined_object THEN NULL;
        END $$;
      `);
    }
    await queryInterface.sequelize.query(
      'ALTER TABLE addresses ADD COLUMN IF NOT EXISTS "deliveryInstructions" TEXT;',
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('addresses', 'deliveryInstructions');
    // Postgres cannot drop enum values; RTO_INITIATED / RTO_DELIVERED stay.
    for (const column of [
      'preferredRedeliverySlot',
      'codCollectedAt',
      'codCollected',
      'codAmount',
      'lastFailedAttemptAt',
      'failedAttemptCount',
      'failureReason',
    ]) {
      await queryInterface.removeColumn('shipments', column);
    }
  },
};
