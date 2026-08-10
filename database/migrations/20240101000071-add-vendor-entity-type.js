'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_vendors_entityType" AS ENUM (
          'SOLE_PROPRIETORSHIP',
          'PARTNERSHIP',
          'LLP',
          'PRIVATE_LIMITED'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryInterface.addColumn('vendors', 'entityType', {
      type: Sequelize.ENUM('SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED'),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('vendors', 'entityType');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_vendors_entityType";');
  },
};
