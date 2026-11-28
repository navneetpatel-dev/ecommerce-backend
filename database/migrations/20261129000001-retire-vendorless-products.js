'use strict';

/**
 * Products without a vendor can no longer be sold: orders, commission, TCS and TDS are filed under a
 * vendor, so such a listing was LIVE yet invisible to shoppers. Any that are live or waiting for
 * approval go back to draft, where a team member can see them. Safe to run again.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE products SET status = 'DRAFT', "updatedAt" = NOW()
      WHERE "vendorId" IS NULL AND status IN ('LIVE', 'PENDING_APPROVAL') AND "deletedAt" IS NULL`);
  },

  // The earlier state could not be sold, so there is nothing to put back.
  async down() {},
};
