'use strict';

/** When a returned-to-origin (RTO) parcel was confirmed back with the seller. Safe to run again. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE shipments ADD COLUMN IF NOT EXISTS "rtoConfirmedAt" TIMESTAMP WITH TIME ZONE;',
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('shipments', 'rtoConfirmedAt');
  },
};
