'use strict';

/** Vendor coupons wait for admin approval before customers can use them. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        ALTER TYPE "enum_coupons_status" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN undefined_object THEN NULL;
      END $$;
    `);
  },

  async down() {
    // Postgres cannot remove enum values safely; leave PENDING_APPROVAL in place.
  },
};
