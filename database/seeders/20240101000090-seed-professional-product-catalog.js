'use strict';

const { assertSeedingAllowed } = require('../seedGuard');

const { randomUUID: uuidv4 } = require('node:crypto');
const {
  buildProductEnrichment,
  buildVariantMatrix,
  skuPrefixFromProductId,
} = require('./lib/professional-catalog');

/**
 * Enriches all LIVE products with professional ecommerce copy and rebuilds
 * variant matrices (Size × Color / Storage × Color, etc.) with deterministic
 * random out-of-stock combinations for PDP testing.
 *
 * Idempotent: SKUs are derived from product UUID (not row index), legacy
 * index-based SKUs are removed, and non-order variants are replaced on re-run.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    assertSeedingAllowed('20240101000090-seed-professional-product-catalog.js');
    const now = new Date();
    const sequelize = queryInterface.sequelize;
    const { QueryTypes } = sequelize;

    console.log('Enriching catalog with professional product data & variant matrices...');

    // Variants that an order or a cart points at are kept (seeded carts stay filled).
    const referencedVariantRows = await sequelize.query(
      `SELECT "variantId" AS id FROM order_items
       UNION SELECT "variantId" AS id FROM cart_items`,
      { type: QueryTypes.SELECT },
    );
    const protectedVariantIds = new Set(referencedVariantRows.map((row) => row.id));

    // Remove legacy index-based SKUs (P00001-…) from prior seeder runs.
    if (protectedVariantIds.size) {
      await sequelize.query(
        `DELETE FROM product_variants
         WHERE sku ~ '^P[0-9]{5}-'
           AND id NOT IN (:protectedIds)`,
        { replacements: { protectedIds: [...protectedVariantIds] } },
      );
    } else {
      await sequelize.query(`DELETE FROM product_variants WHERE sku ~ '^P[0-9]{5}-'`);
    }

    const products = await sequelize.query(
      `SELECT
         p.id,
         p.name,
         p.slug,
         p."basePrice",
         p.status,
         c.name AS category_name,
         c.slug AS category_slug,
         EXISTS (
           SELECT 1 FROM category_attributes a WHERE a."categoryId" = c.id AND a."deletedAt" IS NULL
         ) AS has_filters
       FROM products p
       INNER JOIN categories c ON c.id = p."categoryId"
       WHERE p."deletedAt" IS NULL
         AND p.status = 'LIVE'
       ORDER BY p."createdAt" ASC, p.id ASC`,
      { type: QueryTypes.SELECT },
    );

    let updatedProducts = 0;
    let insertedVariants = 0;
    let deletedVariants = 0;

    for (let index = 0; index < products.length; index++) {
      const product = products[index];
      const enrichment = buildProductEnrichment(product);
      const skuPrefix = skuPrefixFromProductId(product.id);

      await sequelize.query(
        `UPDATE products SET
           brand = :brand,
           "compareAtPrice" = :compareAtPrice,
           description = :description,
           specs = :specs::jsonb,
           highlights = ARRAY(SELECT jsonb_array_elements_text(:highlightsJson::jsonb)),
           tags = ARRAY(SELECT jsonb_array_elements_text(:tagsJson::jsonb)),
           "deliveryNote" = :deliveryNote,
           "returnNote" = :returnNote,
           "updatedAt" = :updatedAt
         WHERE id = :id`,
        {
          replacements: {
            id: product.id,
            brand: enrichment.brand,
            compareAtPrice: enrichment.compareAtPrice,
            description: enrichment.description,
            specs: JSON.stringify(enrichment.specs),
            highlightsJson: JSON.stringify(enrichment.highlights),
            tagsJson: JSON.stringify(enrichment.tags),
            deliveryNote: enrichment.deliveryNote,
            returnNote: enrichment.returnNote,
            updatedAt: now,
          },
        },
      );
      updatedProducts += 1;

      // A category with its own filters already has variants spelling those attributes:
      // replacing them with generic ones would empty the filters.
      if (product.has_filters) continue;

      const existingVariants = await sequelize.query(
        `SELECT id, sku FROM product_variants WHERE "productId" = :productId AND "deletedAt" IS NULL`,
        { replacements: { productId: product.id }, type: QueryTypes.SELECT },
      );

      const deletableIds = existingVariants
        .filter((variant) => !protectedVariantIds.has(variant.id))
        .map((variant) => variant.id);

      if (deletableIds.length) {
        await sequelize.query(`DELETE FROM product_variants WHERE id IN (:ids)`, {
          replacements: { ids: deletableIds },
        });
        deletedVariants += deletableIds.length;
      }

      const matrix = buildVariantMatrix(product, enrichment);
      const kept = existingVariants
        .filter((variant) => protectedVariantIds.has(variant.id))
        .sort((a, b) => a.sku.localeCompare(b.sku));
      const reservedSkus = new Set(kept.map((variant) => variant.sku));

      // Referenced variants keep their id, SKU, price and stock, but take the first option
      // combinations of the matrix, so every option of a product names the same attributes.
      for (let k = 0; k < kept.length && k < matrix.length; k++) {
        await sequelize.query(
          `UPDATE product_variants SET attributes = :attributes::jsonb, "updatedAt" = :updatedAt WHERE id = :id`,
          { replacements: { id: kept[k].id, attributes: JSON.stringify(matrix[k].attributes), updatedAt: now } },
        );
      }

      const rows = [];
      for (const variant of matrix.slice(kept.length)) {
        if (reservedSkus.has(variant.sku)) continue;
        reservedSkus.add(variant.sku);
        rows.push({
          id: uuidv4(),
          productId: product.id,
          sku: variant.sku,
          price: variant.price,
          stock: variant.stock,
          lowStockAt: variant.lowStockAt,
          weightGrams: variant.weightGrams,
          attributes: JSON.stringify(variant.attributes),
          createdAt: now,
          updatedAt: now,
        });
      }

      if (rows.length) {
        await queryInterface.bulkInsert('product_variants', rows);
        insertedVariants += rows.length;
      }

      if ((index + 1) % 100 === 0) {
        console.log(`  Processed ${index + 1}/${products.length} products...`);
      }
    }

    console.log(
      `✓ Enriched ${updatedProducts} products, inserted ${insertedVariants} variants, removed ${deletedVariants} unreferenced variants`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE products SET
        brand = NULL,
        "compareAtPrice" = NULL,
        specs = '{}'::jsonb,
        highlights = ARRAY[]::text[],
        "deliveryNote" = NULL,
        "returnNote" = NULL
    `);
  },
};
