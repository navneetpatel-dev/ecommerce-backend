'use strict';

/**
 * Which payout settled a commission ledger row. Marking a payout failed has to put its
 * rows back for the next payout run; without the link they stayed SETTLED and the vendor
 * was never paid. Rows settled before this column existed stay unlinked.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.addColumn(
        'commission_ledgers',
        'payoutId',
        { type: Sequelize.UUID, allowNull: true, references: { model: 'payouts', key: 'id' } },
        { transaction },
      );
      await queryInterface.addIndex('commission_ledgers', ['payoutId'], {
        name: 'commission_ledgers_payout_id',
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex('commission_ledgers', 'commission_ledgers_payout_id', { transaction });
      await queryInterface.removeColumn('commission_ledgers', 'payoutId', { transaction });
    });
  },
};
