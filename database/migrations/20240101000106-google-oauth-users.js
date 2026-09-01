'use strict';

/** OAuth sign-in: nullable password + optional Google subject id. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('users', 'passwordHash', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('users', 'googleId', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addIndex('users', ['googleId'], {
      name: 'users_google_id_unique',
      unique: true,
      where: { googleId: { [Sequelize.Op.ne]: null } },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('users', 'users_google_id_unique');
    await queryInterface.removeColumn('users', 'googleId');
    await queryInterface.changeColumn('users', 'passwordHash', {
      type: Sequelize.STRING,
      allowNull: false,
    });
  },
};
