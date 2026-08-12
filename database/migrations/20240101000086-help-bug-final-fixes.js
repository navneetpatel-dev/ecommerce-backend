'use strict';

module.exports = {
  async up(queryInterface) {
    // 1. Bug comment keyset index with id tiebreaker (matches ticket message pattern).
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS bug_report_comments_bug_created_id_idx
      ON bug_report_comments ("bugReportId", "createdAt" DESC, id DESC);
    `);

    // 2. Ticket message body length CHECK (matches description constraint pattern).
    await queryInterface.sequelize.query(`
      ALTER TABLE ticket_messages
      ADD CONSTRAINT ticket_messages_body_len_chk
      CHECK (char_length(body) <= 5000);
    `);

    // 3. Remove duplicate FK on support_tickets.relatedOrderId (migration 83 added
    //    support_tickets_related_order_id_fkey; migration 85 added support_tickets_related_order_fk).
    await queryInterface.sequelize.query(`
      ALTER TABLE support_tickets
      DROP CONSTRAINT IF EXISTS support_tickets_related_order_id_fkey;
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS bug_report_comments_bug_created_id_idx;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE ticket_messages
      DROP CONSTRAINT IF EXISTS ticket_messages_body_len_chk;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_related_order_id_fkey
      FOREIGN KEY ("relatedOrderId") REFERENCES orders(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
    `);
  },
};
