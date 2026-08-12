'use strict';

/**
 * Closure fixes for support tickets + bug reports:
 * - bug_reports.verifiedAt (+ partial index for auto-close)
 * - support_tickets.relatedOrderId → orders FK
 * - newsletter_subscribers table
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('bug_reports', 'verifiedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.sequelize.query(`
      UPDATE bug_reports
      SET "verifiedAt" = COALESCE("resolvedAt", "updatedAt", "createdAt")
      WHERE status = 'VERIFIED' AND "verifiedAt" IS NULL AND "deletedAt" IS NULL
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX bug_reports_verified_verified_at_idx
      ON bug_reports ("status", "verifiedAt")
      WHERE status = 'VERIFIED' AND "deletedAt" IS NULL
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_related_order_id_fkey
      FOREIGN KEY ("relatedOrderId") REFERENCES orders (id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `).catch(async (err) => {
      // Skip if orphan relatedOrderId values block the FK — null them first then retry.
      const message = String(err?.message ?? err);
      if (!message.includes('violates foreign key') && !message.includes('ForeignKeyViolation')) {
        throw err;
      }
      await queryInterface.sequelize.query(`
        UPDATE support_tickets st
        SET "relatedOrderId" = NULL
        WHERE st."relatedOrderId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = st."relatedOrderId")
      `);
      await queryInterface.sequelize.query(`
        ALTER TABLE support_tickets
        ADD CONSTRAINT support_tickets_related_order_id_fkey
        FOREIGN KEY ("relatedOrderId") REFERENCES orders (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
      `);
    });

    await queryInterface.createTable('newsletter_subscribers', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      email: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('newsletter_subscribers', ['email'], {
      unique: true,
      name: 'newsletter_subscribers_email_uidx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('newsletter_subscribers');
    await queryInterface.sequelize.query(
      `ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_related_order_id_fkey`,
    );
    await queryInterface.sequelize.query(
      `DROP INDEX IF EXISTS bug_reports_verified_verified_at_idx`,
    );
    await queryInterface.removeColumn('bug_reports', 'verifiedAt').catch(() => undefined);
  },
};
