'use strict';

/**
 * One answer per person per question: a second answer is an edit of the first.
 * Older data has a few repeats; keep each author's earliest answer, then let a
 * partial unique index (live rows only) hold the rule.
 */
const INDEX = 'product_answers_one_per_author_live';

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    await sequelize.query(`
      DELETE FROM product_answers pa
       USING product_answers keep
       WHERE pa."questionId" = keep."questionId"
         AND pa."authorId" = keep."authorId"
         AND pa."deletedAt" IS NULL AND keep."deletedAt" IS NULL
         AND (keep."createdAt", keep.id) < (pa."createdAt", pa.id)`);
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX}"
         ON product_answers ("questionId", "authorId") WHERE "deletedAt" IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${INDEX}"`);
  },
};
