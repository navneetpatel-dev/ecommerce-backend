'use strict';

module.exports = {
  async up(queryInterface) {
    // Guard against the (unexpected) case where two active accounts already
    // differ only by casing — lowercasing them would collide on the unique
    // index. Abort with a clear error rather than silently merging/corrupting
    // data; any such row needs manual review first.
    const [collisions] = await queryInterface.sequelize.query(`
      SELECT lower(email) AS email, count(*) AS count
      FROM users
      WHERE "deletedAt" IS NULL
      GROUP BY lower(email)
      HAVING count(*) > 1
    `);
    if (collisions.length > 0) {
      const emails = collisions.map((row) => row.email).join(', ');
      throw new Error(
        `Cannot lowercase user emails — active accounts already collide case-insensitively: ${emails}. Resolve manually before re-running this migration.`,
      );
    }

    await queryInterface.sequelize.query(`
      UPDATE users SET email = lower(email) WHERE email <> lower(email)
    `);
  },

  // Irreversible: original casing isn't recorded anywhere, so there's nothing
  // to restore. Down is a deliberate no-op.
  async down() {},
};
