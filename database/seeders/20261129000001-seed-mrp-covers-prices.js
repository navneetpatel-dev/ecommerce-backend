'use strict';

const {
  refreshProductDisplayPrices,
  alignMrpWithGstPrices,
  refreshAboveMrpFlags,
} = require('./lib/product-display-price');

/**
 * Runs after every seeder that adds products, prices or tax rules: seeded MRPs include GST and
 * cover each variant, so no demo listing is off sale for being above its MRP.
 */
module.exports = {
  async up(queryInterface) {
    await refreshProductDisplayPrices(queryInterface);
    await alignMrpWithGstPrices(queryInterface);
    await refreshAboveMrpFlags(queryInterface);
  },

  async down() {},
};
