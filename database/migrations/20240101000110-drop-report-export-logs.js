'use strict';

/** Drop legacy async export log table — user exports are now direct downloads. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.dropTable('report_export_logs').catch(() => undefined);
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_report_export_logs_status";',
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.createTable('report_export_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      userId: { type: Sequelize.UUID, allowNull: false },
      reportType: { type: Sequelize.STRING, allowNull: false },
      format: { type: Sequelize.STRING, allowNull: false },
      status: {
        type: Sequelize.ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      filtersUsed: { type: Sequelize.JSONB, allowNull: true },
      fileUrl: { type: Sequelize.STRING, allowNull: true },
      fileKey: { type: Sequelize.STRING, allowNull: true },
      rowCount: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      errorMessage: { type: Sequelize.TEXT, allowNull: true },
      exportedAt: { type: Sequelize.DATE, allowNull: true },
      exportKey: { type: Sequelize.STRING(64), allowNull: true },
      expiresAt: { type: Sequelize.DATE, allowNull: true },
      byteSize: { type: Sequelize.INTEGER, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });
  },
};
