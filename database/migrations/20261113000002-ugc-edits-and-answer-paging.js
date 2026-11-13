'use strict';

/**
 * - `editedAt` on reviews, product questions and answers: owners can now edit
 *   what they posted; the UI marks edited items and edits go back to moderation.
 * - Answers are now read a page at a time per question (a question can carry a
 *   very large thread), filtered to published and ordered by date: index exactly that.
 */
const TABLES = ['reviews', 'product_questions', 'product_answers'];
const ANSWER_INDEX = 'product_answers_question_status_created_live';

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      const columns = await queryInterface.describeTable(table);
      if (!columns.editedAt) {
        await queryInterface.addColumn(table, 'editedAt', { type: Sequelize.DATE, allowNull: true });
      }
    }
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS "${ANSWER_INDEX}"
         ON product_answers ("questionId", status, "createdAt") WHERE "deletedAt" IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${ANSWER_INDEX}"`);
    for (const table of TABLES) {
      const columns = await queryInterface.describeTable(table);
      if (columns.editedAt) await queryInterface.removeColumn(table, 'editedAt');
    }
  },
};
