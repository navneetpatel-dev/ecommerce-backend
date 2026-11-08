'use strict';

/**
 * rejectionNote: why an admin rejected a vendor coupon.
 * showInOffers: whether the coupon is listed as an offer. Bulk, specific-user and segment
 * coupons were never meant to be advertised, so existing ones start hidden.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('coupons');
    if (!table.rejectionNote) {
      await queryInterface.addColumn('coupons', 'rejectionNote', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
    if (!table.showInOffers) {
      await queryInterface.addColumn('coupons', 'showInOffers', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      });
    }
    await queryInterface.sequelize.query(`
      UPDATE coupons SET "showInOffers" = false
      WHERE "batchId" IS NOT NULL
         OR lower("userRestriction"->>'type') IN ('specific', 'segment')
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('coupons');
    if (table.showInOffers) await queryInterface.removeColumn('coupons', 'showInOffers');
    if (table.rejectionNote) await queryInterface.removeColumn('coupons', 'rejectionNote');
  },
};
