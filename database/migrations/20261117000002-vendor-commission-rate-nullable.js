'use strict';

/**
 * vendors.commissionRate becomes an optional per-vendor override.
 *
 * It defaulted to 10.00 for every vendor, so each of them carried a rate and the platform's
 * "Default commission rate" setting never applied to anyone. NULL now means "use the
 * platform default" (a category's own rate still wins over both). Rows still at exactly the
 * old default of 10.00 are treated as never customised and follow the platform default; any
 * other rate was set deliberately and is kept.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('vendors', 'commissionRate', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.sequelize.query(
      'UPDATE "vendors" SET "commissionRate" = NULL WHERE "commissionRate" = 10.00',
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      'UPDATE "vendors" SET "commissionRate" = 10.00 WHERE "commissionRate" IS NULL',
    );
    await queryInterface.changeColumn('vendors', 'commissionRate', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 10.0,
    });
  },
};
