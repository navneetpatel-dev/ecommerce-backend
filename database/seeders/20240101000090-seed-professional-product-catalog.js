'use strict';

const { v4: uuidv4 } = require('uuid');
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
    const now = new Date();
    const sequelize = queryInterface.sequelize;
    const { QueryTypes } = sequelize;

    console.log('Enriching catalog with professional product data & variant matrices...');

    await sequelize.query('DELETE FROM cart_items');

    const orderVariantRows = await sequelize.query(
      `SELECT DISTINCT oi."variantId" AS id FROM order_items oi`,
      { type: QueryTypes.SELECT },
    );
    const protectedVariantIds = new Set(orderVariantRows.map((row) => row.id));

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
         c.slug AS category_slug
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
            updatedAt: now,
          },
        },
      );
      updatedProducts += 1;

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
      const reservedSkus = new Set(
        existingVariants
          .filter((variant) => protectedVariantIds.has(variant.id))
          .map((variant) => variant.sku),
      );

      const rows = [];
      for (const variant of matrix) {
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
        highlights = ARRAY[]::text[]
    `);
  },
};
