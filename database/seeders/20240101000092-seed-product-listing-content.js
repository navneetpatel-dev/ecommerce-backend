'use strict';

const { buildProductEnrichment } = require('./lib/professional-catalog');

/**
 * Backfills vendor-owned listing fields added for PDP (brand, MRP, specs,
 * highlights, tags, delivery/return notes) onto existing products.
 * Idempotent: re-running refreshes the same deterministic copy.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const sequelize = queryInterface.sequelize;
    const { QueryTypes } = sequelize;

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
       ORDER BY p."createdAt" ASC, p.id ASC`,
      { type: QueryTypes.SELECT },
    );

    let updated = 0;
    for (const product of products) {
      const enrichment = buildProductEnrichment(product);
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
      updated += 1;
    }

    console.log(`✓ Backfilled listing content on ${updated} products`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE products SET
        "deliveryNote" = NULL,
        "returnNote" = NULL
    `);
  },
};
