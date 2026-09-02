'use strict';

/** Speed up customer wallet statement exports filtered by user + date range. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('wallet_ledgers', ['userId', 'createdAt'], {
      name: 'wallet_ledgers_user_id_created_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('wallet_ledgers', 'wallet_ledgers_user_id_created_at');
  },
};
