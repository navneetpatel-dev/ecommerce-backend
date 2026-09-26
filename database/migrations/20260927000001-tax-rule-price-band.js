'use strict';

/**
 * GST that depends on each piece's value (e.g. apparel and footwear): an optional band
 * on a tax rule — above `priceBandThreshold` rupees per piece, `gstPercentageAbove`
 * applies instead of `gstPercentage`. Both set, or neither.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tax_rules', 'priceBandThreshold', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('tax_rules', 'gstPercentageAbove', {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tax_rules', 'gstPercentageAbove');
    await queryInterface.removeColumn('tax_rules', 'priceBandThreshold');
  },
};
