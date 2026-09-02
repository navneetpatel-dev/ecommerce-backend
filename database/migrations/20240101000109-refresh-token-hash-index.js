'use strict';

/** Speed up refresh-token lookup and enforce uniqueness at the DB layer. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('refresh_tokens', ['tokenHash'], {
      name: 'refresh_tokens_token_hash_idx',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('refresh_tokens', 'refresh_tokens_token_hash_idx');
  },
};
