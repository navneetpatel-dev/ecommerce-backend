'use strict';

const { buildProductEnrichment, resolveFamily } = require('./lib/professional-catalog');

/**
 * Backfills PDP policy fields: category return/COD/warranty defaults,
 * product warranty/SEO/HSN, vendor performance and COD, platform COD.
 */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const sequelize = queryInterface.sequelize;
    const { QueryTypes } = sequelize;

    const categories = await sequelize.query(
      `SELECT id, name, slug FROM categories WHERE "deletedAt" IS NULL`,
      { type: QueryTypes.SELECT },
    );

    for (const category of categories) {
      const family = resolveFamily(category.slug, category.name);
      const returnWindowDays = family === 'beauty' ? 0 : 7;
      const defaultWarrantyMonths = family === 'electronics' ? 12 : null;
      const defaultWarrantyType = family === 'electronics' ? 'MANUFACTURER' : null;
      await sequelize.query(
        `UPDATE categories SET
           "returnWindowDays" = :returnWindowDays,
           "codEnabled" = TRUE,
           "defaultWarrantyMonths" = :defaultWarrantyMonths,
           "defaultWarrantyType" = :defaultWarrantyType,
           "updatedAt" = :updatedAt
         WHERE id = :id`,
        {
          replacements: {
            id: category.id,
            returnWindowDays,
            defaultWarrantyMonths,
            defaultWarrantyType,
            updatedAt: now,
          },
        },
      );
    }

    const products = await sequelize.query(
      `SELECT
         p.id,
         p.name,
         p.slug,
         p."basePrice",
         c.name AS category_name,
         c.slug AS category_slug
       FROM products p
       INNER JOIN categories c ON c.id = p."categoryId"
       WHERE p."deletedAt" IS NULL
       ORDER BY p."createdAt" ASC, p.id ASC`,
      { type: QueryTypes.SELECT },
    );

    let productCount = 0;
    for (const product of products) {
      const enrichment = buildProductEnrichment(product);
      await sequelize.query(
        `UPDATE products SET
           "warrantyMonths" = :warrantyMonths,
           "warrantyType" = :warrantyType,
           "hsnCode" = :hsnCode,
           "seoTitle" = :seoTitle,
           "seoDescription" = :seoDescription,
           "codEnabled" = NULL,
           "updatedAt" = :updatedAt
         WHERE id = :id`,
        {
          replacements: {
            id: product.id,
            warrantyMonths: enrichment.warrantyMonths,
            warrantyType: enrichment.warrantyType,
            hsnCode: enrichment.hsnCode,
            seoTitle: enrichment.seoTitle,
            seoDescription: enrichment.seoDescription,
            updatedAt: now,
          },
        },
      );
      productCount += 1;
    }

    const vendors = await sequelize.query(
      `SELECT id FROM vendors WHERE "deletedAt" IS NULL`,
      { type: QueryTypes.SELECT },
    );
    let vendorIndex = 0;
    for (const vendor of vendors) {
      const score = (4.1 + (vendorIndex % 9) * 0.1).toFixed(1);
      await sequelize.query(
        `UPDATE vendors SET
           "performanceScore" = :score,
           "codEnabled" = TRUE,
           "updatedAt" = :updatedAt
         WHERE id = :id`,
        {
          replacements: { id: vendor.id, score, updatedAt: now },
        },
      );
      vendorIndex += 1;
    }

    await sequelize.query(
      `UPDATE platform_settings
       SET value = COALESCE(value, '{}'::jsonb) || :patch::jsonb,
           "updatedAt" = :updatedAt
       WHERE key = 'platform'`,
      {
        replacements: {
          patch: JSON.stringify({
            codEnabled: true,
            codMinOrderValue: 0,
            codMaxOrderValue: null,
            returnShippingFee: 0,
          }),
          updatedAt: now,
        },
      },
    );

    console.log(
      `✓ PDP policy backfill: ${categories.length} categories, ${productCount} products, ${vendors.length} vendors`,
    );
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(`
      UPDATE categories SET
        "returnWindowDays" = NULL,
        "defaultWarrantyMonths" = NULL,
        "defaultWarrantyType" = NULL
    `);
    await sequelize.query(`
      UPDATE products SET
        "warrantyMonths" = NULL,
        "warrantyType" = NULL,
        "hsnCode" = NULL,
        "seoTitle" = NULL,
        "seoDescription" = NULL,
        "codEnabled" = NULL
    `);
  },
};
