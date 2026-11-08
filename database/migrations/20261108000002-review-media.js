'use strict';

/**
 * Photos and a video on a product review: `[{ url, type: 'IMAGE' | 'VIDEO', durationSeconds }]`,
 * uploaded under `reviews/{reviewId}/attachments/`. Safe to run again.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE reviews ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE reviews DROP COLUMN IF EXISTS media;');
  },
};
