'use strict';

/** "My answers" reads one author's answers newest-first; index exactly that (live rows). */
const INDEX = 'product_answers_author_created_live';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `CREATE INDEX IF NOT EXISTS "${INDEX}"
         ON product_answers ("authorId", "createdAt" DESC) WHERE "deletedAt" IS NULL`,
    );
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${INDEX}"`);
  },
};
