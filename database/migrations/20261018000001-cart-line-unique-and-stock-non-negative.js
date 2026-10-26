'use strict';

/**
 * Database guards against overselling.
 *
 * 1. One live cart line per (cart, variant). Two concurrent add-to-cart calls for the
 *    same variant could each find no line and each insert one, and checkout then
 *    decremented stock once per line. Existing duplicates are merged first: the oldest
 *    line keeps the summed quantity (capped at the 99-unit line limit), the others are
 *    soft-deleted like a removed line.
 * 2. Variant stock can never go negative. Every decrement runs under the checkout's
 *    variant lock; this makes a missed check fail the order instead of overselling.
 *    Fails if a variant is already negative — fix that stock by hand first.
 */

const CART_LINE_INDEX = 'cart_items_cart_variant_live_unique';
const STOCK_CHECK = 'product_variants_stock_non_negative';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { transaction });

      await run(`
        WITH ranked AS (
          SELECT id, "cartId", "variantId", quantity,
                 ROW_NUMBER() OVER (PARTITION BY "cartId", "variantId" ORDER BY "createdAt", id) AS rn,
                 SUM(quantity) OVER (PARTITION BY "cartId", "variantId") AS total
          FROM cart_items
          WHERE "deletedAt" IS NULL
        )
        UPDATE cart_items AS c
        SET quantity = LEAST(r.total, 99), "updatedAt" = NOW()
        FROM ranked r
        WHERE c.id = r.id AND r.rn = 1 AND r.total <> r.quantity
      `);
      await run(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (PARTITION BY "cartId", "variantId" ORDER BY "createdAt", id) AS rn
          FROM cart_items
          WHERE "deletedAt" IS NULL
        )
        UPDATE cart_items AS c
        SET "deletedAt" = NOW()
        FROM ranked r
        WHERE c.id = r.id AND r.rn > 1
      `);
      await run(`
        CREATE UNIQUE INDEX "${CART_LINE_INDEX}"
        ON cart_items ("cartId", "variantId")
        WHERE "deletedAt" IS NULL
      `);
      await run(`
        ALTER TABLE product_variants
        ADD CONSTRAINT "${STOCK_CHECK}" CHECK (stock >= 0)
      `);
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const run = (sql) => queryInterface.sequelize.query(sql, { transaction });
      await run(`ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS "${STOCK_CHECK}"`);
      await run(`DROP INDEX IF EXISTS "${CART_LINE_INDEX}"`);
    });
  },
};
