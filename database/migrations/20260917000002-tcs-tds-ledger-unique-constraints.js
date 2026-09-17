'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Duplicate RETURN_ADJUSTMENT rows (identical amounts, milliseconds apart) are
    // retry double-writes. Keep the earliest row per group; soft-delete the rest.
    await queryInterface.sequelize.query(`
      UPDATE tcs_ledgers AS t
      SET "deletedAt" = NOW()
      FROM (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY "subOrderId", "entryType"
            ORDER BY "createdAt" ASC, id ASC
          ) AS rn
        FROM tcs_ledgers
        WHERE "deletedAt" IS NULL
      ) AS ranked
      WHERE t.id = ranked.id
        AND ranked.rn > 1
        AND t."deletedAt" IS NULL
    `);

    await queryInterface.sequelize.query(`
      UPDATE tds_ledgers AS t
      SET "deletedAt" = NOW()
      FROM (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY "subOrderId"
            ORDER BY "createdAt" ASC, id ASC
          ) AS rn
        FROM tds_ledgers
        WHERE "deletedAt" IS NULL
      ) AS ranked
      WHERE t.id = ranked.id
        AND ranked.rn > 1
        AND t."deletedAt" IS NULL
    `);

    const [tcsDupes] = await queryInterface.sequelize.query(`
      SELECT "subOrderId", "entryType", COUNT(*)::int AS cnt
      FROM tcs_ledgers
      WHERE "deletedAt" IS NULL
      GROUP BY "subOrderId", "entryType"
      HAVING COUNT(*) > 1
    `);
    if (tcsDupes.length > 0) {
      throw new Error(
        `Cannot add tcs_ledgers_sub_order_entry_type_unique: ${tcsDupes.length} duplicate (subOrderId, entryType) groups remain after dedupe`,
      );
    }

    const [tdsDupes] = await queryInterface.sequelize.query(`
      SELECT "subOrderId", COUNT(*)::int AS cnt
      FROM tds_ledgers
      WHERE "deletedAt" IS NULL
      GROUP BY "subOrderId"
      HAVING COUNT(*) > 1
    `);
    if (tdsDupes.length > 0) {
      throw new Error(
        `Cannot add tds_ledgers_sub_order_unique: ${tdsDupes.length} duplicate subOrderId groups remain after dedupe`,
      );
    }

    const tcsIndexes = await queryInterface.showIndex('tcs_ledgers');
    if (!tcsIndexes.some((idx) => idx.name === 'tcs_ledgers_sub_order_entry_type_unique')) {
      await queryInterface.addIndex('tcs_ledgers', ['subOrderId', 'entryType'], {
        unique: true,
        name: 'tcs_ledgers_sub_order_entry_type_unique',
        where: { deletedAt: null },
      });
    }

    const tdsIndexes = await queryInterface.showIndex('tds_ledgers');
    if (!tdsIndexes.some((idx) => idx.name === 'tds_ledgers_sub_order_unique')) {
      await queryInterface.addIndex('tds_ledgers', ['subOrderId'], {
        unique: true,
        name: 'tds_ledgers_sub_order_unique',
        where: { deletedAt: null },
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('tcs_ledgers', 'tcs_ledgers_sub_order_entry_type_unique').catch(() => undefined);
    await queryInterface.removeIndex('tds_ledgers', 'tds_ledgers_sub_order_unique').catch(() => undefined);
  },
};
