'use strict';

/** Unique in-flight exportKey so duplicate clicks cannot enqueue twice. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS report_export_logs_inflight_export_key
      ON report_export_logs ("exportKey")
      WHERE status IN ('PENDING', 'PROCESSING')
        AND "exportKey" IS NOT NULL
        AND "deletedAt" IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS report_export_logs_inflight_export_key
    `);
  },
};
