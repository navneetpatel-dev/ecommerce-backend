'use strict';

/** Device-captured GPS fix on each address, powering the delivery-tracking live-ETA distance. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('addresses', 'lat', {
      type: Sequelize.DECIMAL(9, 6),
      allowNull: true,
    });
    await queryInterface.addColumn('addresses', 'lng', {
      type: Sequelize.DECIMAL(9, 6),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('addresses', 'lng');
    await queryInterface.removeColumn('addresses', 'lat');
  },
};
