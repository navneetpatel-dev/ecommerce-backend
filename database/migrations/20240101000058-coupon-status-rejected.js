'use strict';

/** Add REJECTED to coupons.status for admin moderation of vendor coupons. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        ALTER TYPE "enum_coupons_status" ADD VALUE IF NOT EXISTS 'REJECTED';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
      END $$;
    `);
  },

  async down() {
    // Postgres cannot remove enum values safely; leave REJECTED in place.
  },
};
