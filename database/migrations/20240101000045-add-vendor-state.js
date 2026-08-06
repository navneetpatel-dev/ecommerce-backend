'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('vendors', 'state', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    // Seeded GST numbers use Karnataka prefix (29); backfill so GST intra/inter-state works.
    await queryInterface.sequelize.query(
      `UPDATE vendors SET state = 'Karnataka' WHERE state IS NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('vendors', 'state');
  },
};
