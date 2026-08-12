'use strict';

/** Gap-fix indexes, ticket read receipts, and bug inProgressAt. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ticket_reads', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      ticketId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'support_tickets', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      lastReadAt: { type: Sequelize.DATE, allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ticket_reads', ['ticketId', 'userId'], {
      unique: true,
      name: 'ticket_reads_ticket_user_uidx',
    });

    await queryInterface.removeIndex(
      'support_tickets',
      'support_tickets_active_status_created_idx',
    ).catch(() => undefined);
    await queryInterface.sequelize.query(`
      CREATE INDEX support_tickets_active_status_created_idx
      ON support_tickets ("status", "createdAt" DESC)
      WHERE status NOT IN ('CLOSED', 'RESOLVED') AND "deletedAt" IS NULL
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX support_tickets_resolved_resolved_at_idx
      ON support_tickets ("status", "resolvedAt")
      WHERE status = 'RESOLVED' AND "deletedAt" IS NULL
    `);
    await queryInterface.addIndex('support_tickets', ['category', 'status'], {
      name: 'support_tickets_category_status_idx',
    });

    await queryInterface.addColumn('bug_reports', 'inProgressAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.removeIndex(
      'bug_reports',
      'bug_reports_active_status_created_idx',
    ).catch(() => undefined);
    await queryInterface.sequelize.query(`
      CREATE INDEX bug_reports_active_status_severity_created_idx
      ON bug_reports ("status", "severity", "createdAt" DESC)
      WHERE status NOT IN ('CLOSED', 'WONT_FIX') AND "deletedAt" IS NULL
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX bug_reports_fixed_resolved_at_idx
      ON bug_reports ("status", "resolvedAt")
      WHERE status = 'FIXED' AND "deletedAt" IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS bug_reports_fixed_resolved_at_idx`,
    );
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS bug_reports_active_status_severity_created_idx`,
    );
    await queryInterface.removeColumn('bug_reports', 'inProgressAt').catch(() => undefined);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS bug_reports_active_status_created_idx
      ON bug_reports ("status", "createdAt" DESC)
      WHERE status NOT IN ('CLOSED', 'WONT_FIX') AND "deletedAt" IS NULL
    `);

    await queryInterface.removeIndex(
      'support_tickets',
      'support_tickets_category_status_idx',
    ).catch(() => undefined);
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS support_tickets_resolved_resolved_at_idx`,
    );
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS support_tickets_active_status_created_idx`,
    );
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS support_tickets_active_status_created_idx
      ON support_tickets ("status", "createdAt" DESC)
      WHERE status NOT IN ('CLOSED') AND "deletedAt" IS NULL
    `);
    await queryInterface.dropTable('ticket_reads');
  },
};
