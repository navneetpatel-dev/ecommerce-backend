'use strict';

/**
 * A return can be a refund or an exchange, and an exchange records when its replacement
 * was handed over. Safe to run again: each column is added only when missing.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_return_requests_type" AS ENUM ('REFUND', 'EXCHANGE');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE return_requests
        ADD COLUMN IF NOT EXISTS "type" "enum_return_requests_type" NOT NULL DEFAULT 'REFUND',
        ADD COLUMN IF NOT EXISTS "replacementDeliveredAt" TIMESTAMP WITH TIME ZONE;
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('return_requests', 'replacementDeliveredAt');
    await queryInterface.removeColumn('return_requests', 'type');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_return_requests_type";');
  },
};
