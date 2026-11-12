'use strict';

/**
 * Who receives a parcel and the number the courier calls (B-37). Nullable for the
 * rows that exist; those are filled from the account holder's name and phone.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('addresses', 'recipientName', { type: Sequelize.STRING(100), allowNull: true });
    await queryInterface.addColumn('addresses', 'recipientPhone', { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.sequelize.query(
      `UPDATE addresses a SET "recipientName" = u.name, "recipientPhone" = u.phone
       FROM users u WHERE u.id = a."userId" AND a."recipientName" IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('addresses', 'recipientPhone');
    await queryInterface.removeColumn('addresses', 'recipientName');
  },
};
