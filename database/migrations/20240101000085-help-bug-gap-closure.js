'use strict';

/**
 * Gap closure for support tickets + bug reports:
 * - Nullable bug severity (unset until reporter chooses / admin triages)
 * - Bug description / steps length CHECKs
 * - Ticket relatedOrderId FK, senderRole CHECK, message keyset index
 * - Drop redundant non-partial bug status index
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE bug_reports
        ALTER COLUMN severity DROP NOT NULL,
        ALTER COLUMN severity DROP DEFAULT;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE bug_reports
        DROP CONSTRAINT IF EXISTS bug_reports_description_len_chk;
      ALTER TABLE bug_reports
        ADD CONSTRAINT bug_reports_description_len_chk
        CHECK (char_length(description) <= 5000);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE bug_reports
        DROP CONSTRAINT IF EXISTS bug_reports_steps_len_chk;
      ALTER TABLE bug_reports
        ADD CONSTRAINT bug_reports_steps_len_chk
        CHECK (
          "stepsToReproduce" IS NULL
          OR char_length("stepsToReproduce") <= 3000
        );
    `);

    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS bug_reports_status_severity_created_idx;
    `);

    // Clean orphan order refs before adding FK.
    await queryInterface.sequelize.query(`
      UPDATE support_tickets st
      SET "relatedOrderId" = NULL
      WHERE "relatedOrderId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = st."relatedOrderId" AND o."deletedAt" IS NULL
        );
    `);

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        ALTER TABLE support_tickets
          ADD CONSTRAINT support_tickets_related_order_fk
          FOREIGN KEY ("relatedOrderId") REFERENCES orders(id)
          ON UPDATE CASCADE ON DELETE SET NULL;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE ticket_messages
        DROP CONSTRAINT IF EXISTS ticket_messages_sender_role_chk;
      ALTER TABLE ticket_messages
        ADD CONSTRAINT ticket_messages_sender_role_chk
        CHECK (
          "senderRole" IN (
            'CUSTOMER',
            'VENDOR',
            'VENDOR_STAFF',
            'ADMIN',
            'SUPER_ADMIN',
            'ADMIN_ORDER_MANAGER',
            'ADMIN_CATALOG_MANAGER'
          )
        );
    `);

    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS ticket_messages_ticket_created_id_idx;
      CREATE INDEX ticket_messages_ticket_created_id_idx
        ON ticket_messages ("ticketId", "createdAt" DESC, id DESC)
        WHERE "deletedAt" IS NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS ticket_messages_ticket_created_id_idx;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE ticket_messages
        DROP CONSTRAINT IF EXISTS ticket_messages_sender_role_chk;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE support_tickets
        DROP CONSTRAINT IF EXISTS support_tickets_related_order_fk;
    `);

    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS bug_reports_status_severity_created_idx
        ON bug_reports (status, severity, "createdAt");
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE bug_reports
        DROP CONSTRAINT IF EXISTS bug_reports_description_len_chk;
      ALTER TABLE bug_reports
        DROP CONSTRAINT IF EXISTS bug_reports_steps_len_chk;
    `);

    // Restore NOT NULL severity — backfill nulls first.
    await queryInterface.sequelize.query(`
      UPDATE bug_reports SET severity = 'MEDIUM' WHERE severity IS NULL;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE bug_reports
        ALTER COLUMN severity SET DEFAULT 'MEDIUM',
        ALTER COLUMN severity SET NOT NULL;
    `);
  },
};
