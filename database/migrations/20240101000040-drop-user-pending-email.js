'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('users', 'pendingEmail');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'pendingEmail', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },
};
