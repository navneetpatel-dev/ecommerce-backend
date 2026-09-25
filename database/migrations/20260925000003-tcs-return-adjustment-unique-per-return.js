'use strict';

/**
 * TCS return adjustments are one per return, not one per sub-order.
 *
 * 20260917000002 made (subOrderId, entryType) unique on tcs_ledgers to stop retry
 * double-writes. But every approved return on a TCS-bearing sub-order writes its own
 * RETURN_ADJUSTMENT row, so approving a second return from the same vendor sub-order
 * failed with a unique violation. That migration's dedupe also soft-deleted the
 * adjustment rows of every return after the first on a sub-order, so those GSTR-8
 * adjustments disappeared from TCS reports.
 *
 * 1. Replace the index with two partial unique indexes:
 *    - one COLLECTION row per sub-order;
 *    - one RETURN_ADJUSTMENT row per return request.
 * 2. Restore the adjustment of each approved return that has no live adjustment:
 *    the earliest soft-deleted row carrying its returnRequestId. Retry duplicates
 *    share a returnRequestId with the surviving row, so they stay deleted. Only the
 *    earlier dedupe can have deleted these rows: cancellation and RTO remove TCS rows
 *    before delivery, when no return can exist yet.
 */

const OLD_INDEX = 'tcs_ledgers_sub_order_entry_type_unique';
const COLLECTION_INDEX = 'tcs_ledgers_collection_sub_order_unique';
const ADJUSTMENT_INDEX = 'tcs_ledgers_return_adjustment_unique';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { transaction });

      await run(`DROP INDEX IF EXISTS "${OLD_INDEX}"`);

      await run(`
        UPDATE tcs_ledgers AS t
        SET "deletedAt" = NULL
        FROM (
          SELECT DISTINCT ON (d."returnRequestId") d.id
          FROM tcs_ledgers d
          INNER JOIN return_requests rr ON rr.id = d."returnRequestId" AND rr."deletedAt" IS NULL
          WHERE d."entryType" = 'RETURN_ADJUSTMENT'
            AND d."deletedAt" IS NOT NULL
            AND rr.status <> 'REJECTED'
            AND NOT EXISTS (
              SELECT 1 FROM tcs_ledgers live
              WHERE live."returnRequestId" = d."returnRequestId"
                AND live."entryType" = 'RETURN_ADJUSTMENT'
                AND live."deletedAt" IS NULL
            )
          ORDER BY d."returnRequestId", d."createdAt" ASC, d.id ASC
        ) AS restore
        WHERE t.id = restore.id
      `);

      await run(`
        CREATE UNIQUE INDEX "${COLLECTION_INDEX}"
        ON tcs_ledgers ("subOrderId")
        WHERE "entryType" = 'COLLECTION' AND "deletedAt" IS NULL
      `);
      await run(`
        CREATE UNIQUE INDEX "${ADJUSTMENT_INDEX}"
        ON tcs_ledgers ("returnRequestId")
        WHERE "entryType" = 'RETURN_ADJUSTMENT' AND "deletedAt" IS NULL
      `);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
      // The old (subOrderId, entryType) index cannot hold once a sub-order has two live
      // adjustments — which is the correct state after a second return. Refuse rather
      // than soft-delete real GSTR-8 adjustments again.
      const [multi] = await run(`
        SELECT "subOrderId" FROM tcs_ledgers
        WHERE "deletedAt" IS NULL
        GROUP BY "subOrderId", "entryType"
        HAVING COUNT(*) > 1
        LIMIT 1
      `);
      if (multi.length > 0) {
        throw new Error(
          `Cannot restore ${OLD_INDEX}: some sub-orders have more than one live TCS row per entry type (legitimate multiple returns).`,
        );
      }
      await run(`DROP INDEX IF EXISTS "${COLLECTION_INDEX}"`);
      await run(`DROP INDEX IF EXISTS "${ADJUSTMENT_INDEX}"`);
      await run(`
        CREATE UNIQUE INDEX "${OLD_INDEX}"
        ON tcs_ledgers ("subOrderId", "entryType")
        WHERE "deletedAt" IS NULL
      `);
    });
  },
};
