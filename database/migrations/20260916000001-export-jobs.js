'use strict';

/** Persisted record for every on-demand async export (progress, ownership, result location, TTL). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (!names.includes('export_jobs')) {
      await queryInterface.createTable('export_jobs', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        ownerId: { type: Sequelize.UUID, allowNull: false },
        domain: { type: Sequelize.STRING(40), allowNull: false },
        exportType: { type: Sequelize.STRING(80), allowNull: false },
        format: { type: Sequelize.ENUM('csv', 'xlsx', 'pdf'), allowNull: false },
        status: {
          type: Sequelize.ENUM('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'),
          allowNull: false,
          defaultValue: 'QUEUED',
        },
        filters: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        progressPercent: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        rowsProcessed: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        totalRowsEstimate: { type: Sequelize.INTEGER, allowNull: true },
        resultKey: { type: Sequelize.STRING(512), allowNull: true },
        filename: { type: Sequelize.STRING(255), allowNull: true },
        byteSize: { type: Sequelize.INTEGER, allowNull: true },
        errorMessage: { type: Sequelize.STRING(500), allowNull: true },
        errorCode: { type: Sequelize.STRING(80), allowNull: true },
        startedAt: { type: Sequelize.DATE, allowNull: true },
        completedAt: { type: Sequelize.DATE, allowNull: true },
        expiresAt: { type: Sequelize.DATE, allowNull: true },
        /** Set once the owner has downloaded or explicitly dismissed a
         *  finished (COMPLETED/FAILED) job — see the "browser refresh / tab
         *  close" note near the bottom of Step 17. Null means "finished, but
         *  nobody has seen the result yet" — that's what lets a job that
         *  completed while the tab was closed resurface next time the owner
         *  opens the app, without also resurfacing jobs they've already
         *  handled. */
        acknowledgedAt: { type: Sequelize.DATE, allowNull: true },
        createdAt: Sequelize.DATE,
        updatedAt: Sequelize.DATE,
      });
      await queryInterface.addIndex('export_jobs', ['ownerId', 'createdAt']);
      await queryInterface.addIndex('export_jobs', ['status', 'expiresAt']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('export_jobs');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_export_jobs_format";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_export_jobs_status";');
  },
};
