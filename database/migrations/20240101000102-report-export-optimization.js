'use strict';

/** Report export optimization: dedup keys, TTL, PROCESSING status, byte size. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        ALTER TYPE "enum_report_export_logs_status" ADD VALUE IF NOT EXISTS 'PROCESSING';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    const table = await queryInterface.describeTable('report_export_logs');
    if (!table.exportKey) {
      await queryInterface.addColumn('report_export_logs', 'exportKey', {
        type: Sequelize.STRING(64),
        allowNull: true,
      });
    }
    if (!table.expiresAt) {
      await queryInterface.addColumn('report_export_logs', 'expiresAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!table.byteSize) {
      await queryInterface.addColumn('report_export_logs', 'byteSize', {
        type: Sequelize.BIGINT,
        allowNull: true,
      });
    }

    await queryInterface.addIndex('report_export_logs', ['exportKey', 'status'], {
      name: 'report_export_logs_export_key_status',
    });
    await queryInterface.addIndex('report_export_logs', ['expiresAt'], {
      name: 'report_export_logs_expires_at',
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('report_export_logs');
    await queryInterface.removeIndex('report_export_logs', 'report_export_logs_export_key_status').catch(() => undefined);
    await queryInterface.removeIndex('report_export_logs', 'report_export_logs_expires_at').catch(() => undefined);
    if (table.byteSize) await queryInterface.removeColumn('report_export_logs', 'byteSize');
    if (table.expiresAt) await queryInterface.removeColumn('report_export_logs', 'expiresAt');
    if (table.exportKey) await queryInterface.removeColumn('report_export_logs', 'exportKey');
  },
};
