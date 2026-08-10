'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('bug_reports', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      reportNumber: { type: Sequelize.STRING(32), allowNull: false, unique: true },
      reporterId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
      },
      reporterRole: {
        type: Sequelize.ENUM('CUSTOMER', 'VENDOR', 'VENDOR_STAFF'),
        allowNull: false,
      },
      title: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false },
      stepsToReproduce: { type: Sequelize.TEXT, allowNull: true },
      severity: {
        type: Sequelize.ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
        allowNull: false,
        defaultValue: 'MEDIUM',
      },
      status: {
        type: Sequelize.ENUM(
          'NEW',
          'TRIAGED',
          'IN_PROGRESS',
          'FIXED',
          'VERIFIED',
          'CLOSED',
          'WONT_FIX',
          'DUPLICATE',
        ),
        allowNull: false,
        defaultValue: 'NEW',
      },
      duplicateOfId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'bug_reports', key: 'id' },
        onDelete: 'SET NULL',
      },
      assignedToId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      affectedModule: {
        type: Sequelize.ENUM(
          'CATALOG',
          'CART',
          'CHECKOUT',
          'PAYMENTS',
          'ORDERS',
          'VENDOR_DASHBOARD',
          'ADMIN_DASHBOARD',
          'OTHER',
        ),
        allowNull: false,
        defaultValue: 'OTHER',
      },
      pageUrl: { type: Sequelize.STRING(2048), allowNull: true },
      userAgent: { type: Sequelize.TEXT, allowNull: true },
      browserName: { type: Sequelize.STRING(128), allowNull: true },
      osName: { type: Sequelize.STRING(128), allowNull: true },
      deviceType: { type: Sequelize.STRING(32), allowNull: true },
      appVersion: { type: Sequelize.STRING(64), allowNull: true },
      userId: { type: Sequelize.UUID, allowNull: false },
      userRole: { type: Sequelize.STRING(64), allowNull: false },
      occurredAt: { type: Sequelize.DATE, allowNull: false },
      triagedAt: { type: Sequelize.DATE, allowNull: true },
      resolvedAt: { type: Sequelize.DATE, allowNull: true },
      wontFixReason: { type: Sequelize.TEXT, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('bug_reports', ['reporterId', 'status'], {
      name: 'bug_reports_reporter_status_idx',
    });
    await queryInterface.addIndex('bug_reports', ['status', 'severity', 'createdAt'], {
      name: 'bug_reports_status_severity_created_idx',
    });
    await queryInterface.sequelize.query(`
      CREATE INDEX bug_reports_active_status_created_idx
      ON bug_reports (status, "createdAt")
      WHERE status NOT IN ('CLOSED', 'WONT_FIX') AND "deletedAt" IS NULL
    `);

    await queryInterface.createTable('bug_report_attachments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      bugReportId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'bug_reports', key: 'id' },
        onDelete: 'CASCADE',
      },
      url: { type: Sequelize.STRING(1024), allowNull: false },
      type: {
        type: Sequelize.ENUM('SCREENSHOT', 'SCREEN_RECORDING'),
        allowNull: false,
      },
      durationSeconds: { type: Sequelize.INTEGER, allowNull: true },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('bug_report_attachments', ['bugReportId'], {
      name: 'bug_report_attachments_bug_report_idx',
    });

    await queryInterface.createTable('bug_report_comments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      bugReportId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'bug_reports', key: 'id' },
        onDelete: 'CASCADE',
      },
      authorId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'RESTRICT',
      },
      body: { type: Sequelize.TEXT, allowNull: false },
      createdBy: { type: Sequelize.UUID, allowNull: true },
      updatedBy: { type: Sequelize.UUID, allowNull: true },
      deletedBy: { type: Sequelize.UUID, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('bug_report_comments', ['bugReportId', 'createdAt'], {
      name: 'bug_report_comments_bug_created_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('bug_report_comments');
    await queryInterface.dropTable('bug_report_attachments');
    await queryInterface.dropTable('bug_reports');
  },
};
