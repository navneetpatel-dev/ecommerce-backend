'use strict';

/**
 * Edits to approved reviews / questions / answers wait beside the live version:
 * - `pendingRevision` (JSONB): the author's proposed edit. Shoppers keep seeing
 *   the approved version until a moderator approves the edit (which swaps it in)
 *   or rejects it (which drops only the edit).
 * - `revisionRejectedAt`: when the author's last edit was turned down, so their
 *   own view can say so. Cleared by their next edit or an approval.
 * Partial indexes keep the moderation queues ("anything awaiting a decision") cheap.
 */
const TABLES = ['reviews', 'product_questions', 'product_answers'];
const indexName = (table) => `${table}_pending_revision`;

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      const columns = await queryInterface.describeTable(table);
      if (!columns.pendingRevision) {
        await queryInterface.addColumn(table, 'pendingRevision', { type: Sequelize.JSONB, allowNull: true });
      }
      if (!columns.revisionRejectedAt) {
        await queryInterface.addColumn(table, 'revisionRejectedAt', { type: Sequelize.DATE, allowNull: true });
      }
      await queryInterface.sequelize.query(
        `CREATE INDEX IF NOT EXISTS "${indexName(table)}"
           ON ${table} ("createdAt") WHERE "pendingRevision" IS NOT NULL AND "deletedAt" IS NULL`,
      );
    }
  },

  async down(queryInterface) {
    for (const table of TABLES) {
      await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${indexName(table)}"`);
      const columns = await queryInterface.describeTable(table);
      if (columns.revisionRejectedAt) await queryInterface.removeColumn(table, 'revisionRejectedAt');
      if (columns.pendingRevision) await queryInterface.removeColumn(table, 'pendingRevision');
    }
  },
};
