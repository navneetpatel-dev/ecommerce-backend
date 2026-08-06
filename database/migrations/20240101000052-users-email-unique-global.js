'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Resolve any duplicate emails across roles before restoring global uniqueness.
    // Keep the oldest active row; rename later duplicates so the unique index can apply.
    await queryInterface.sequelize.query(`
      WITH ranked AS (
        SELECT
          id,
          email,
          ROW_NUMBER() OVER (
            PARTITION BY lower(email)
            ORDER BY "createdAt" ASC, id ASC
          ) AS rn
        FROM users
        WHERE "deletedAt" IS NULL
      )
      UPDATE users AS u
      SET email = split_part(u.email, '@', 1) || '+dup' || ranked.rn::text || '@' || split_part(u.email, '@', 2)
      FROM ranked
      WHERE u.id = ranked.id
        AND ranked.rn > 1;
    `);

    await queryInterface.removeIndex('users', 'users_email_role_id_unique').catch(async () => {
      // Index may already be absent on fresh DBs that never ran 049.
    });

    await queryInterface.addIndex('users', ['email'], {
      unique: true,
      name: 'users_email_unique',
      where: { deletedAt: null },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_email_unique');
    await queryInterface.addIndex('users', ['email', 'roleId'], {
      unique: true,
      name: 'users_email_role_id_unique',
      where: { deletedAt: null },
    });
  },
};
