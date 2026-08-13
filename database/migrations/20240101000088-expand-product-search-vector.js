'use strict';

/**
 * Expand products.search_vector with vendor businessName, category name, and variant SKUs.
 * Refresh vectors when related vendor / category / variant rows change.
 */
module.exports = {
  async up(queryInterface) {
    const run = async (sql) => {
      try {
        await queryInterface.sequelize.query(sql);
      } catch (err) {
        const message = String(err?.message ?? err);
        if (
          message.includes('already exists') ||
          message.includes('duplicate key') ||
          message.includes('duplicate column')
        ) {
          return;
        }
        throw err;
      }
    };

    await run('CREATE EXTENSION IF NOT EXISTS pg_trgm');

    await run(`
      CREATE OR REPLACE FUNCTION products_rebuild_search_vector(p_id uuid)
      RETURNS void AS $$
      BEGIN
        UPDATE products p
        SET search_vector = (
          SELECT
            setweight(to_tsvector('english', coalesce(p2.name, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(v."businessName", '')), 'A') ||
            setweight(to_tsvector('english', coalesce(c.name, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(array_to_string(p2.tags, ' '), '')), 'B') ||
            setweight(
              to_tsvector(
                'english',
                coalesce((
                  SELECT string_agg(pv.sku, ' ')
                  FROM product_variants pv
                  WHERE pv."productId" = p2.id
                    AND pv."deletedAt" IS NULL
                ), '')
              ),
              'A'
            ) ||
            setweight(to_tsvector('english', coalesce(p2.description, '')), 'C')
          FROM products p2
          LEFT JOIN vendors v ON v.id = p2."vendorId"
          LEFT JOIN categories c ON c.id = p2."categoryId"
          WHERE p2.id = p_id
        )
        WHERE p.id = p_id;
      END;
      $$ LANGUAGE plpgsql
    `);

    await run(`
      CREATE OR REPLACE FUNCTION products_search_vector_update()
      RETURNS trigger AS $$
      DECLARE
        vendor_name text := '';
        category_name text := '';
        sku_text text := '';
      BEGIN
        IF NEW."vendorId" IS NOT NULL THEN
          SELECT coalesce(v."businessName", '') INTO vendor_name
          FROM vendors v WHERE v.id = NEW."vendorId";
        END IF;

        IF NEW."categoryId" IS NOT NULL THEN
          SELECT coalesce(c.name, '') INTO category_name
          FROM categories c WHERE c.id = NEW."categoryId";
        END IF;

        IF TG_OP = 'UPDATE' OR NEW.id IS NOT NULL THEN
          SELECT coalesce(string_agg(pv.sku, ' '), '') INTO sku_text
          FROM product_variants pv
          WHERE pv."productId" = NEW.id
            AND pv."deletedAt" IS NULL;
        END IF;

        NEW.search_vector :=
          setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(vendor_name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(category_name, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
          setweight(to_tsvector('english', coalesce(sku_text, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await run(`
      DROP TRIGGER IF EXISTS products_search_vector_trigger ON products
    `);

    await run(`
      CREATE TRIGGER products_search_vector_trigger
      BEFORE INSERT OR UPDATE OF name, tags, description, "vendorId", "categoryId"
      ON products
      FOR EACH ROW
      EXECUTE FUNCTION products_search_vector_update()
    `);

    await run(`
      CREATE OR REPLACE FUNCTION product_variants_refresh_product_search_vector()
      RETURNS trigger AS $$
      DECLARE
        target_id uuid;
      BEGIN
        target_id := COALESCE(NEW."productId", OLD."productId");
        IF target_id IS NOT NULL THEN
          PERFORM products_rebuild_search_vector(target_id);
        END IF;
        IF TG_OP = 'UPDATE'
          AND NEW."productId" IS DISTINCT FROM OLD."productId"
          AND OLD."productId" IS NOT NULL THEN
          PERFORM products_rebuild_search_vector(OLD."productId");
        END IF;
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql
    `);

    await run(`
      DROP TRIGGER IF EXISTS product_variants_search_vector_trigger ON product_variants
    `);

    await run(`
      CREATE TRIGGER product_variants_search_vector_trigger
      AFTER INSERT OR UPDATE OF sku, "productId", "deletedAt" OR DELETE
      ON product_variants
      FOR EACH ROW
      EXECUTE FUNCTION product_variants_refresh_product_search_vector()
    `);

    await run(`
      CREATE OR REPLACE FUNCTION vendors_refresh_product_search_vectors()
      RETURNS trigger AS $$
      DECLARE
        r record;
      BEGIN
        IF TG_OP = 'UPDATE' AND NEW."businessName" IS NOT DISTINCT FROM OLD."businessName" THEN
          RETURN NEW;
        END IF;
        FOR r IN
          SELECT id FROM products
          WHERE "vendorId" = NEW.id AND "deletedAt" IS NULL
        LOOP
          PERFORM products_rebuild_search_vector(r.id);
        END LOOP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await run(`
      DROP TRIGGER IF EXISTS vendors_search_vector_trigger ON vendors
    `);

    await run(`
      CREATE TRIGGER vendors_search_vector_trigger
      AFTER UPDATE OF "businessName" ON vendors
      FOR EACH ROW
      EXECUTE FUNCTION vendors_refresh_product_search_vectors()
    `);

    await run(`
      CREATE OR REPLACE FUNCTION categories_refresh_product_search_vectors()
      RETURNS trigger AS $$
      DECLARE
        r record;
      BEGIN
        IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
          RETURN NEW;
        END IF;
        FOR r IN
          SELECT id FROM products
          WHERE "categoryId" = NEW.id AND "deletedAt" IS NULL
        LOOP
          PERFORM products_rebuild_search_vector(r.id);
        END LOOP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await run(`
      DROP TRIGGER IF EXISTS categories_search_vector_trigger ON categories
    `);

    await run(`
      CREATE TRIGGER categories_search_vector_trigger
      AFTER UPDATE OF name ON categories
      FOR EACH ROW
      EXECUTE FUNCTION categories_refresh_product_search_vectors()
    `);

    await run(`
      CREATE INDEX IF NOT EXISTS vendors_business_name_trgm_idx
      ON vendors USING GIN ("businessName" gin_trgm_ops)
    `);
    await run(`
      CREATE INDEX IF NOT EXISTS categories_name_trgm_idx
      ON categories USING GIN (name gin_trgm_ops)
    `);
    await run(`
      CREATE INDEX IF NOT EXISTS product_variants_sku_trgm_idx
      ON product_variants USING GIN (sku gin_trgm_ops)
    `);

    await run(`
      UPDATE products p
      SET search_vector = (
        SELECT
          setweight(to_tsvector('english', coalesce(p2.name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(v."businessName", '')), 'A') ||
          setweight(to_tsvector('english', coalesce(c.name, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(array_to_string(p2.tags, ' '), '')), 'B') ||
          setweight(
            to_tsvector(
              'english',
              coalesce((
                SELECT string_agg(pv.sku, ' ')
                FROM product_variants pv
                WHERE pv."productId" = p2.id
                  AND pv."deletedAt" IS NULL
              ), '')
            ),
            'A'
          ) ||
          setweight(to_tsvector('english', coalesce(p2.description, '')), 'C')
        FROM products p2
        LEFT JOIN vendors v ON v.id = p2."vendorId"
        LEFT JOIN categories c ON c.id = p2."categoryId"
        WHERE p2.id = p.id
      )
    `);
  },

  async down(queryInterface) {
    const run = async (sql) => {
      try {
        await queryInterface.sequelize.query(sql);
      } catch (_) {
        /* best-effort rollback */
      }
    };

    await run('DROP TRIGGER IF EXISTS categories_search_vector_trigger ON categories');
    await run('DROP TRIGGER IF EXISTS vendors_search_vector_trigger ON vendors');
    await run('DROP TRIGGER IF EXISTS product_variants_search_vector_trigger ON product_variants');
    await run('DROP FUNCTION IF EXISTS categories_refresh_product_search_vectors()');
    await run('DROP FUNCTION IF EXISTS vendors_refresh_product_search_vectors()');
    await run('DROP FUNCTION IF EXISTS product_variants_refresh_product_search_vector()');
    await run('DROP FUNCTION IF EXISTS products_rebuild_search_vector(uuid)');

    await run(`
      CREATE OR REPLACE FUNCTION products_search_vector_update()
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B') ||
          setweight(to_tsvector('english', coalesce(NEW.description, '')), 'C');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await run('DROP TRIGGER IF EXISTS products_search_vector_trigger ON products');
    await run(`
      CREATE TRIGGER products_search_vector_trigger
      BEFORE INSERT OR UPDATE OF name, tags, description ON products
      FOR EACH ROW
      EXECUTE FUNCTION products_search_vector_update()
    `);
  },
};
