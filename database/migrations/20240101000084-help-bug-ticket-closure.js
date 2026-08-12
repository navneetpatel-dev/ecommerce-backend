'use strict';

/**
 * Closure fixes for help / support tickets / bug reports:
 * - Drop legacy help_tickets (replaced by support_tickets)
 * - Add DB CHECKs for ticket description length and satisfaction rating
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS help_tickets CASCADE;
    `);

    // Drop leftover enum types from help_tickets if present (safe no-op when missing).
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        DROP TYPE IF EXISTS "enum_help_tickets_topic";
        DROP TYPE IF EXISTS "enum_help_tickets_status";
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE support_tickets
        DROP CONSTRAINT IF EXISTS support_tickets_description_len_chk;
      ALTER TABLE support_tickets
        ADD CONSTRAINT support_tickets_description_len_chk
        CHECK (char_length(description) <= 5000);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE support_tickets
        DROP CONSTRAINT IF EXISTS support_tickets_rating_range_chk;
      ALTER TABLE support_tickets
        ADD CONSTRAINT support_tickets_rating_range_chk
        CHECK (
          "customerSatisfactionRating" IS NULL
          OR ("customerSatisfactionRating" >= 1 AND "customerSatisfactionRating" <= 5)
        );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE support_tickets
        DROP CONSTRAINT IF EXISTS support_tickets_description_len_chk;
      ALTER TABLE support_tickets
        DROP CONSTRAINT IF EXISTS support_tickets_rating_range_chk;
    `);

    // Recreate a minimal help_tickets shell so down is reversible for local rollback.
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS help_tickets (
        id UUID PRIMARY KEY,
        "userId" UUID,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(255) NOT NULL,
        topic VARCHAR(32) NOT NULL DEFAULT 'OTHER',
        subject VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        "orderId" UUID,
        status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
        "createdBy" UUID,
        "updatedBy" UUID,
        "deletedBy" UUID,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL,
        "deletedAt" TIMESTAMPTZ
      );
    `);
  },
};
