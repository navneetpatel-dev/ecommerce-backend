'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Drop global unique on email (constraint name varies by PG/Sequelize).
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'users_email_key'
        ) THEN
          ALTER TABLE users DROP CONSTRAINT users_email_key;
        END IF;
      END $$;
    `);

    const indexes = await queryInterface.showIndex('users');
    for (const index of indexes) {
      const fields = (index.fields || []).map((f) => (typeof f === 'string' ? f : f.attribute));
      if (index.unique && fields.length === 1 && fields[0] === 'email') {
        await queryInterface.removeIndex('users', index.name);
      }
    }

    // Same email allowed across roles; not within the same role (active rows only).
    await queryInterface.addIndex('users', ['email', 'roleId'], {
      unique: true,
      name: 'users_email_role_id_unique',
      where: { deletedAt: null },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_email_role_id_unique');
    await queryInterface.addIndex('users', ['email'], {
      unique: true,
      name: 'users_email_key',
    });
  },
};
