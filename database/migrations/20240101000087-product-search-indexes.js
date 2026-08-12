'use strict';

/**
 * PostgreSQL full-text + trigram indexes for product search/autocomplete.
 * search_vector is maintained by trigger (to_tsvector is STABLE, not valid for GENERATED).
 * See backend/implementation.md §7.
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
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS search_vector tsvector
    `);

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

    await run(`
      DROP TRIGGER IF EXISTS products_search_vector_trigger ON products
    `);

    await run(`
      CREATE TRIGGER products_search_vector_trigger
      BEFORE INSERT OR UPDATE OF name, tags, description ON products
      FOR EACH ROW
      EXECUTE FUNCTION products_search_vector_update()
    `);

    await run(`
      UPDATE products
      SET search_vector =
        setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'B') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'C')
      WHERE search_vector IS NULL
    `);

    await run(
      'CREATE INDEX IF NOT EXISTS products_search_vector_idx ON products USING GIN (search_vector)',
    );
    await run(
      'CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON products USING GIN (name gin_trgm_ops)',
    );
    await run(`
      CREATE INDEX IF NOT EXISTS products_live_category_idx
      ON products ("categoryId")
      WHERE status = 'LIVE' AND "deletedAt" IS NULL
    `);
    await run(`
      CREATE INDEX IF NOT EXISTS products_live_vendor_idx
      ON products ("vendorId")
      WHERE status = 'LIVE' AND "deletedAt" IS NULL
    `);
    await run(`
      CREATE INDEX IF NOT EXISTS products_live_category_price_idx
      ON products ("categoryId", "basePrice")
      WHERE status = 'LIVE' AND "deletedAt" IS NULL
    `);

    await run('ANALYZE products');
  },

  async down(queryInterface) {
    const drop = async (sql) => {
      try {
        await queryInterface.sequelize.query(sql);
      } catch {
        /* ignore */
      }
    };

    await drop('DROP TRIGGER IF EXISTS products_search_vector_trigger ON products');
    await drop('DROP FUNCTION IF EXISTS products_search_vector_update()');
    await drop('DROP INDEX IF EXISTS products_live_category_price_idx');
    await drop('DROP INDEX IF EXISTS products_live_vendor_idx');
    await drop('DROP INDEX IF EXISTS products_live_category_idx');
    await drop('DROP INDEX IF EXISTS products_name_trgm_idx');
    await drop('DROP INDEX IF EXISTS products_search_vector_idx');
    await drop('ALTER TABLE products DROP COLUMN IF EXISTS search_vector');
  },
};
