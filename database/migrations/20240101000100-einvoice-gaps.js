'use strict';

/**
 * Vendor registered address + buyer GSTIN on addresses (GST compliance, non-IRN).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const vendor = await queryInterface.describeTable('vendors');
    if (!vendor.addressLine1) {
      await queryInterface.addColumn('vendors', 'addressLine1', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }
    if (!vendor.city) {
      await queryInterface.addColumn('vendors', 'city', {
        type: Sequelize.STRING(100),
        allowNull: true,
      });
    }
    if (!vendor.pincode) {
      await queryInterface.addColumn('vendors', 'pincode', {
        type: Sequelize.STRING(12),
        allowNull: true,
      });
    }

    const address = await queryInterface.describeTable('addresses');
    if (!address.gstin) {
      await queryInterface.addColumn('addresses', 'gstin', {
        type: Sequelize.STRING(20),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const address = await queryInterface.describeTable('addresses');
    if (address.gstin) await queryInterface.removeColumn('addresses', 'gstin');

    const vendor = await queryInterface.describeTable('vendors');
    for (const col of ['pincode', 'city', 'addressLine1']) {
      if (vendor[col]) await queryInterface.removeColumn('vendors', col);
    }
  },
};
