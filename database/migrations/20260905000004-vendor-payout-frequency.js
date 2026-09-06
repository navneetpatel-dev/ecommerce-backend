'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_vendors_payoutFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    const table = await queryInterface.describeTable('vendors');
    if (!table.payoutFrequency) {
      await queryInterface.addColumn('vendors', 'payoutFrequency', {
        type: Sequelize.ENUM('WEEKLY', 'BIWEEKLY', 'MONTHLY'),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('vendors');
    if (table.payoutFrequency) {
      await queryInterface.removeColumn('vendors', 'payoutFrequency');
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_vendors_payoutFrequency";');
  },
};
