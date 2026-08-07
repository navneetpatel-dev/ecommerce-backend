'use strict';

const { randomUUID } = require('crypto');

/**
 * Idempotent category-system seed (unique `cs-*` slugs to avoid colliding with comprehensive seed):
 * - 3 departments × nested depth 3 with displayOrder / SEO / commission
 * - CategoryAttributes on leaf (Material ENUM, Capacity RANGE, InStock BOOLEAN)
 * - Products + variants with matching attribute keys
 * - TaxRules on parent + leaf (fallback proof)
 * - One ARCHIVED category with a LIVE product (nav hidden, PDP still works)
 */

const SEED_PRODUCT_SLUGS = [
  'seed-steel-frying-pan',
  'seed-iron-frying-pan',
  'seed-nonstick-frying-pan',
  'seed-stock-pot-basic',
  'seed-archived-category-pan',
];

const SEED_CATEGORY_SLUGS = [
  'cs-archived-cookware-promo',
  'cs-frying-pans',
  'cs-stock-pots',
  'cs-food-containers',
  'cs-kitchen-storage',
  'cs-cookware',
  'cs-apparel-tshirts',
  'cs-apparel-tops',
  'cs-apparel',
  'cs-camp-cooksets',
  'cs-camping',
  'cs-outdoor',
  'cs-home-kitchen',
];

async function hasRow(queryInterface, sql) {
  const [rows] = await queryInterface.sequelize.query(sql);
  return rows.length > 0;
}

async function ensureCategory(queryInterface, row) {
  const [existing] = await queryInterface.sequelize.query(
    `SELECT id FROM categories WHERE slug = '${row.slug}' LIMIT 1`,
  );
  if (existing[0]?.id) {
    await queryInterface.sequelize.query(
      `UPDATE categories SET
        name = :name,
        "parentId" = :parentId,
        "imageUrl" = :imageUrl,
        status = :status,
        "displayOrder" = :displayOrder,
        "seoTitle" = :seoTitle,
        "seoDescription" = :seoDescription,
        "commissionRate" = :commissionRate,
        "updatedAt" = :updatedAt
      WHERE id = :id`,
      {
        replacements: {
          id: existing[0].id,
          name: row.name,
          parentId: row.parentId,
          imageUrl: row.imageUrl,
          status: row.status,
          displayOrder: row.displayOrder,
          seoTitle: row.seoTitle,
          seoDescription: row.seoDescription,
          commissionRate: row.commissionRate,
          updatedAt: row.updatedAt,
        },
      },
    );
    return existing[0].id;
  }
  await queryInterface.bulkInsert('categories', [row]);
  return row.id;
}

async function deleteSeedProducts(queryInterface) {
  const [products] = await queryInterface.sequelize.query(
    `SELECT id FROM products WHERE slug IN (${SEED_PRODUCT_SLUGS.map((s) => `'${s}'`).join(',')})`,
  );
  const ids = products.map((p) => p.id);
  if (!ids.length) return;
  const inList = ids.map((id) => `'${id}'`).join(',');
  await queryInterface.sequelize.query(`DELETE FROM product_variants WHERE "productId" IN (${inList})`);
  await queryInterface.sequelize.query(`DELETE FROM product_images WHERE "productId" IN (${inList})`);
  await queryInterface.sequelize.query(`DELETE FROM product_categories WHERE "productId" IN (${inList})`);
  await queryInterface.sequelize.query(`DELETE FROM products WHERE id IN (${inList})`);
}

module.exports = {
  async up(queryInterface) {
    const stamp = new Date();

    const [vendors] = await queryInterface.sequelize.query(
      `SELECT id, "commissionRate" FROM vendors WHERE status = 'APPROVED' ORDER BY "createdAt" ASC LIMIT 3`,
    );
    if (!vendors.length) {
      console.log('⏭ Category system seed skipped — no APPROVED vendors');
      return;
    }

    await queryInterface.sequelize.query(
      `UPDATE vendors SET "commissionRate" = 12.5 WHERE id = '${vendors[0].id}' AND "commissionRate" IS NOT NULL`,
    );

    // Clean previous seed products if re-run with new category layout
    await deleteSeedProducts(queryInterface);

    // Remove prior cs-* tree artifacts (attrs/tax first)
    const [oldCats] = await queryInterface.sequelize.query(
      `SELECT id FROM categories WHERE slug IN (${SEED_CATEGORY_SLUGS.map((s) => `'${s}'`).join(',')})`,
    );
    if (oldCats.length) {
      const catIds = oldCats.map((c) => `'${c.id}'`).join(',');
      await queryInterface.sequelize.query(
        `DELETE FROM category_attributes WHERE "categoryId" IN (${catIds})`,
      );
      await queryInterface.sequelize.query(`DELETE FROM tax_rules WHERE "categoryId" IN (${catIds})`);
      // Detach any leftover products from prior cookware/frying-pans non-cs slugs created under wrong parents
    }

    // Also clean non-prefixed leftovers from first seed attempt
    const leftoverSlugs = [
      'archived-cookware-promo',
      'frying-pans',
      'stock-pots',
      'food-containers',
      'kitchen-storage',
      'cookware',
      'apparel-tshirts',
      'apparel-tops',
      'apparel-dept',
      'camp-cooksets',
      'camping',
      'outdoor-dept',
    ];
    const [leftovers] = await queryInterface.sequelize.query(
      `SELECT id FROM categories WHERE slug IN (${leftoverSlugs.map((s) => `'${s}'`).join(',')})`,
    );
    if (leftovers.length) {
      const ids = leftovers.map((c) => `'${c.id}'`).join(',');
      await queryInterface.sequelize.query(
        `UPDATE products SET "categoryId" = (
          SELECT id FROM categories WHERE status = 'ACTIVE' AND "parentId" IS NOT NULL LIMIT 1
        ) WHERE "categoryId" IN (${ids}) AND slug NOT LIKE 'seed-%'`,
      );
      await queryInterface.sequelize.query(
        `DELETE FROM category_attributes WHERE "categoryId" IN (${ids})`,
      );
      await queryInterface.sequelize.query(`DELETE FROM tax_rules WHERE "categoryId" IN (${ids})`);
      await queryInterface.sequelize.query(`DELETE FROM categories WHERE id IN (${ids})`);
    }

    const departments = [
      {
        name: 'Home & Kitchen',
        slug: 'cs-home-kitchen',
        displayOrder: 1,
        seoTitle: 'Home & Kitchen Essentials',
        seoDescription: 'Cookware, dining, and storage for every home.',
        commissionRate: 8.5,
        imageUrl: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=400&fit=crop',
        children: [
          {
            name: 'Cookware',
            slug: 'cs-cookware',
            displayOrder: 1,
            seoTitle: 'Cookware',
            seoDescription: 'Pots, pans, and everyday cooking tools.',
            commissionRate: 7.0,
            children: [
              {
                name: 'Frying Pans',
                slug: 'cs-frying-pans',
                displayOrder: 1,
                seoTitle: 'Frying Pans',
                seoDescription: 'Non-stick and stainless frying pans.',
                commissionRate: null,
              },
              {
                name: 'Stock Pots',
                slug: 'cs-stock-pots',
                displayOrder: 2,
                seoTitle: 'Stock Pots',
                seoDescription: 'Large pots for soups and stews.',
                commissionRate: 6.5,
              },
            ],
          },
          {
            name: 'Storage',
            slug: 'cs-kitchen-storage',
            displayOrder: 2,
            seoTitle: 'Kitchen Storage',
            seoDescription: 'Containers and organizers.',
            commissionRate: null,
            children: [
              {
                name: 'Food Containers',
                slug: 'cs-food-containers',
                displayOrder: 1,
                seoTitle: 'Food Containers',
                seoDescription: 'Airtight containers for leftovers.',
                commissionRate: null,
              },
            ],
          },
        ],
      },
      {
        name: 'Apparel',
        slug: 'cs-apparel',
        displayOrder: 2,
        seoTitle: 'Apparel',
        seoDescription: 'Everyday clothing for men and women.',
        commissionRate: 10,
        imageUrl: 'https://images.unsplash.com/photo-1441986304907-64674bd600d8?w=400&fit=crop',
        children: [
          {
            name: 'Tops',
            slug: 'cs-apparel-tops',
            displayOrder: 1,
            seoTitle: 'Tops',
            seoDescription: 'T-shirts, shirts, and blouses.',
            commissionRate: null,
            children: [
              {
                name: 'T-Shirts',
                slug: 'cs-apparel-tshirts',
                displayOrder: 1,
                seoTitle: 'T-Shirts',
                seoDescription: 'Soft tees in everyday fits.',
                commissionRate: 11,
              },
            ],
          },
        ],
      },
      {
        name: 'Outdoor',
        slug: 'cs-outdoor',
        displayOrder: 3,
        seoTitle: 'Outdoor Gear',
        seoDescription: 'Camping and trail essentials.',
        commissionRate: null,
        imageUrl: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=400&fit=crop',
        children: [
          {
            name: 'Camping',
            slug: 'cs-camping',
            displayOrder: 1,
            seoTitle: 'Camping',
            seoDescription: 'Tents, cooksets, and trail kits.',
            commissionRate: 9,
            children: [
              {
                name: 'Camp Cooksets',
                slug: 'cs-camp-cooksets',
                displayOrder: 1,
                seoTitle: 'Camp Cooksets',
                seoDescription: 'Lightweight cookware for the trail.',
                commissionRate: null,
              },
            ],
          },
        ],
      },
    ];

    const leafIds = {};
    const parentIds = {};

    for (const dept of departments) {
      const deptId = await ensureCategory(queryInterface, {
        id: randomUUID(),
        name: dept.name,
        slug: dept.slug,
        parentId: null,
        imageUrl: dept.imageUrl ?? null,
        status: 'ACTIVE',
        displayOrder: dept.displayOrder,
        seoTitle: dept.seoTitle,
        seoDescription: dept.seoDescription,
        commissionRate: dept.commissionRate,
        createdAt: stamp,
        updatedAt: stamp,
      });
      parentIds[dept.slug] = deptId;

      for (const cat of dept.children) {
        const catId = await ensureCategory(queryInterface, {
          id: randomUUID(),
          name: cat.name,
          slug: cat.slug,
          parentId: deptId,
          imageUrl: null,
          status: 'ACTIVE',
          displayOrder: cat.displayOrder,
          seoTitle: cat.seoTitle,
          seoDescription: cat.seoDescription,
          commissionRate: cat.commissionRate,
          createdAt: stamp,
          updatedAt: stamp,
        });
        parentIds[cat.slug] = catId;

        for (const leaf of cat.children ?? []) {
          const leafId = await ensureCategory(queryInterface, {
            id: randomUUID(),
            name: leaf.name,
            slug: leaf.slug,
            parentId: catId,
            imageUrl: null,
            status: 'ACTIVE',
            displayOrder: leaf.displayOrder,
            seoTitle: leaf.seoTitle,
            seoDescription: leaf.seoDescription,
            commissionRate: leaf.commissionRate,
            createdAt: stamp,
            updatedAt: stamp,
          });
          leafIds[leaf.slug] = leafId;
        }
      }
    }

    const archivedId = await ensureCategory(queryInterface, {
      id: randomUUID(),
      name: 'Archived Cookware Promo',
      slug: 'cs-archived-cookware-promo',
      parentId: parentIds['cs-cookware'] ?? null,
      imageUrl: null,
      status: 'ARCHIVED',
      displayOrder: 99,
      seoTitle: 'Archived Cookware Promo',
      seoDescription: 'Hidden from nav; products remain reachable.',
      commissionRate: null,
      createdAt: stamp,
      updatedAt: stamp,
    });

    const fryingPanId = leafIds['cs-frying-pans'];
    if (fryingPanId) {
      const attrDefs = [
        {
          name: 'Material',
          type: 'ENUM',
          options: JSON.stringify(['steel', 'iron', 'nonstick']),
          displayOrder: 0,
        },
        {
          name: 'Capacity',
          type: 'RANGE',
          options: JSON.stringify(['1L', '2L', '3L']),
          displayOrder: 1,
        },
        {
          name: 'InStock',
          type: 'BOOLEAN',
          options: JSON.stringify([]),
          displayOrder: 2,
        },
      ];
      for (const def of attrDefs) {
        const exists = await hasRow(
          queryInterface,
          `SELECT id FROM category_attributes WHERE "categoryId" = '${fryingPanId}' AND name = '${def.name}' AND "deletedAt" IS NULL LIMIT 1`,
        );
        if (!exists) {
          await queryInterface.bulkInsert('category_attributes', [
            {
              id: randomUUID(),
              categoryId: fryingPanId,
              name: def.name,
              type: def.type,
              options: def.options,
              displayOrder: def.displayOrder,
              createdBy: null,
              updatedBy: null,
              deletedBy: null,
              createdAt: stamp,
              updatedAt: stamp,
            },
          ]);
        }
      }
    }

    const cookwareId = parentIds['cs-cookware'];
    const taxPairs = [
      { categoryId: cookwareId, gstPercentage: 12, hsnCode: '7323' },
      { categoryId: fryingPanId, gstPercentage: 18, hsnCode: '732393' },
    ];
    for (const tax of taxPairs) {
      if (!tax.categoryId) continue;
      const exists = await hasRow(
        queryInterface,
        `SELECT id FROM tax_rules WHERE "categoryId" = '${tax.categoryId}' AND "deletedAt" IS NULL LIMIT 1`,
      );
      if (!exists) {
        await queryInterface.bulkInsert('tax_rules', [
          {
            id: randomUUID(),
            categoryId: tax.categoryId,
            hsnCode: tax.hsnCode,
            gstPercentage: tax.gstPercentage,
            createdBy: null,
            updatedBy: null,
            deletedBy: null,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ]);
      }
    }

    const productSpecs = [
      {
        slug: 'seed-steel-frying-pan',
        name: 'Seed Steel Frying Pan',
        categoryId: fryingPanId,
        vendorId: vendors[0].id,
        basePrice: 1299,
        attrs: { Material: 'steel', Capacity: '2L', InStock: 'true' },
      },
      {
        slug: 'seed-iron-frying-pan',
        name: 'Seed Iron Frying Pan',
        categoryId: fryingPanId,
        vendorId: vendors[1]?.id ?? vendors[0].id,
        basePrice: 1499,
        attrs: { Material: 'iron', Capacity: '3L', InStock: 'true' },
      },
      {
        slug: 'seed-nonstick-frying-pan',
        name: 'Seed Nonstick Frying Pan',
        categoryId: fryingPanId,
        vendorId: vendors[2]?.id ?? vendors[0].id,
        basePrice: 999,
        attrs: { Material: 'nonstick', Capacity: '1L', InStock: 'false' },
      },
      {
        slug: 'seed-stock-pot-basic',
        name: 'Seed Stock Pot Basic',
        categoryId: leafIds['cs-stock-pots'],
        vendorId: vendors[0].id,
        basePrice: 1899,
        attrs: { Material: 'steel' },
      },
      {
        slug: 'seed-archived-category-pan',
        name: 'Seed Archived Category Pan',
        categoryId: archivedId,
        vendorId: vendors[0].id,
        basePrice: 799,
        attrs: { Material: 'steel' },
      },
    ];

    for (const spec of productSpecs) {
      if (!spec.categoryId) continue;
      const exists = await hasRow(
        queryInterface,
        `SELECT id FROM products WHERE slug = '${spec.slug}' LIMIT 1`,
      );
      if (exists) continue;

      const productId = randomUUID();
      await queryInterface.bulkInsert('products', [
        {
          id: productId,
          vendorId: spec.vendorId,
          categoryId: spec.categoryId,
          name: spec.name,
          slug: spec.slug,
          description: `${spec.name} — category system verification product.`,
          basePrice: spec.basePrice,
          status: 'LIVE',
          tags: ['category-system', 'seed'],
          avgRating: 4.2,
          createdAt: stamp,
          updatedAt: stamp,
        },
      ]);

      await queryInterface.bulkInsert('product_variants', [
        {
          id: randomUUID(),
          productId,
          sku: `${spec.slug}-default`,
          attributes: JSON.stringify(spec.attrs),
          price: spec.basePrice,
          stock: spec.attrs.InStock === 'false' ? 0 : 25,
          weightGrams: 500,
          lowStockAt: 5,
          createdAt: stamp,
          updatedAt: stamp,
        },
      ]);

      await queryInterface.bulkInsert('product_images', [
        {
          id: randomUUID(),
          productId,
          url: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=600&fit=crop',
          isPrimary: true,
          createdAt: stamp,
          updatedAt: stamp,
        },
      ]);
    }

    console.log('✓ Category system seed applied (cs-* taxonomy)');
  },

  async down(queryInterface) {
    await deleteSeedProducts(queryInterface);
    const [cats] = await queryInterface.sequelize.query(
      `SELECT id FROM categories WHERE slug IN (${SEED_CATEGORY_SLUGS.map((s) => `'${s}'`).join(',')})`,
    );
    if (cats.length) {
      const ids = cats.map((c) => `'${c.id}'`).join(',');
      await queryInterface.sequelize.query(
        `DELETE FROM category_attributes WHERE "categoryId" IN (${ids})`,
      );
      await queryInterface.sequelize.query(`DELETE FROM tax_rules WHERE "categoryId" IN (${ids})`);
      await queryInterface.sequelize.query(`DELETE FROM categories WHERE id IN (${ids})`);
    }
  },
};
