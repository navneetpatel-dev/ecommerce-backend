'use strict';

const { v4: uuidv4 } = require('uuid');
const {
  MIN_PRODUCT_GALLERY_IMAGES,
  buildGalleryUrls,
  resolveGalleryKey,
} = require('./lib/product-gallery-images');

/** Ensures every product has at least {@link MIN_PRODUCT_GALLERY_IMAGES} gallery images. */
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const sequelize = queryInterface.sequelize;
    const { QueryTypes } = sequelize;

    const products = await sequelize.query(
      `SELECT
         p.id,
         c.slug AS category_slug,
         c.name AS category_name
       FROM products p
       INNER JOIN categories c ON c.id = p."categoryId"
       WHERE p."deletedAt" IS NULL
       ORDER BY p."createdAt" ASC, p.id ASC`,
      { type: QueryTypes.SELECT },
    );

    let updatedProducts = 0;
    let insertedImages = 0;

    for (const product of products) {
      const existing = await sequelize.query(
        `SELECT id, url, "isPrimary"
         FROM product_images
         WHERE "productId" = :productId AND "deletedAt" IS NULL
         ORDER BY "isPrimary" DESC, "createdAt" ASC, id ASC`,
        {
          replacements: { productId: product.id },
          type: QueryTypes.SELECT,
        },
      );

      if (existing.length >= MIN_PRODUCT_GALLERY_IMAGES) continue;

      const galleryKey = resolveGalleryKey(product.category_slug, product.category_name);
      const targetUrls = buildGalleryUrls(galleryKey, product.id, MIN_PRODUCT_GALLERY_IMAGES);
      const existingUrls = new Set(existing.map((row) => row.url));
      const needed = MIN_PRODUCT_GALLERY_IMAGES - existing.length;
      const rows = [];

      for (const url of targetUrls) {
        if (rows.length >= needed) break;
        if (existingUrls.has(url)) continue;
        rows.push({
          id: uuidv4(),
          productId: product.id,
          url,
          isPrimary: false,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (rows.length === 0) continue;

      if (existing.length === 0) {
        rows[0].isPrimary = true;
      }

      await queryInterface.bulkInsert('product_images', rows);
      updatedProducts += 1;
      insertedImages += rows.length;
    }

    console.log(
      `✓ Product gallery seed: ${insertedImages} images added across ${updatedProducts} products (target ${MIN_PRODUCT_GALLERY_IMAGES}+ each)`,
    );
  },

  async down(queryInterface) {
    // Non-destructive: gallery images may include vendor uploads mixed with seed URLs.
    console.log('↷ Skipping product gallery seed undo (non-destructive seeder).');
  },
};
