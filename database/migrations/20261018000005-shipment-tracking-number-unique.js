'use strict';

/**
 * One live shipment per tracking number. Tracking numbers are typed in by vendors, and
 * carrier webhooks, the customer's reschedule and the tracking page all find a shipment
 * by its number alone: a number two shipments shared let one carrier update (even
 * "delivered") land on the other customer's parcel.
 */
const INDEX = 'shipments_tracking_number_live_unique';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX "${INDEX}" ON shipments ("trackingNumber")
       WHERE "deletedAt" IS NULL AND "trackingNumber" IS NOT NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${INDEX}"`);
  },
};
