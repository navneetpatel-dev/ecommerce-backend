'use strict';

/**
 * Short links were created through a public endpoint with no validation, so existing rows can hold
 * an off-site redirect target (`//evil.com`, `/\evil.com`), markup that reaches an inline script, and
 * caller-supplied preview text. The API now recomputes all of it on every read; this cleans the
 * stored rows too. Safe to run again. Not reversible (the discarded values were untrusted input).
 */

// Postgres bracket expression: control characters, backslash, < > " ' ` { } and space.
const UNSAFE_CHARS = '[\\x01-\\x1f\\x7f\\\\<>"\'`{} ]';
// Must start with one "/" that is not followed by another "/" or a backslash.
const NOT_A_SITE_PATH = '^/([^/\\\\]|$)';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `UPDATE short_links
         SET "targetUrl" = '/', "updatedAt" = NOW()
         WHERE "targetUrl" !~ :sitePath
            OR "targetUrl" ~ :unsafe
            OR length("targetUrl") > 2048`,
        { transaction, replacements: { sitePath: NOT_A_SITE_PATH, unsafe: UNSAFE_CHARS } },
      );
      // Preview data is derived from the catalog at read time; stored caller input is dropped.
      await queryInterface.sequelize.query(
        `UPDATE short_links SET metadata = NULL, "updatedAt" = NOW() WHERE metadata IS NOT NULL`,
        { transaction },
      );
    });
  },

  async down() {
    // Intentionally empty: the removed values were untrusted caller input.
  },
};
