'use strict';

/** Remove unused wallet ledger (cashback settlement path retired). */
module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((t) => (typeof t === 'string' ? t : t.tableName || t));
    if (names.includes('wallet_ledgers')) {
      await queryInterface.dropTable('wallet_ledgers');
    }
    try {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_wallet_ledgers_type";');
    } catch {
      // ignore missing enum
    }
  },

  async down() {
    // Intentionally not recreated — wallet feature removed.
  },
};
