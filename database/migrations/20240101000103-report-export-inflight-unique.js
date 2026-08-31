'use strict';

/** Unique in-flight exportKey so duplicate clicks cannot enqueue twice. */
module.exports = {
  async up(queryInterface) {
    const pendingStaleCutoff = new Date(Date.now() - 15 * 60 * 1000);
    const processingStaleCutoff = new Date(Date.now() - 30 * 60 * 1000);
    await queryInterface.sequelize.query(
      `
      UPDATE report_export_logs
      SET status = 'FAILED', "errorMessage" = 'Stale inflight export cleared before unique index'
      WHERE status IN ('PENDING', 'PROCESSING')
        AND "exportKey" IS NOT NULL
        AND "deletedAt" IS NULL
        AND (
          (status = 'PENDING' AND "createdAt" < :pendingCutoff)
          OR (status = 'PROCESSING' AND "updatedAt" < :processingCutoff)
        )
      `,
      {
        replacements: {
          pendingCutoff: pendingStaleCutoff.toISOString(),
          processingCutoff: processingStaleCutoff.toISOString(),
        },
      },
    );

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
