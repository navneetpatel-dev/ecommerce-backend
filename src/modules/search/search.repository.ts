import { sequelize } from '@database/models';
import { QueryTypes } from 'sequelize';
import {
  CATEGORY_STATUS,
  PRODUCT_STATUS,
  REVIEW_STATUS,
  VENDOR_STATUS,
} from '@core/constants/statuses';
import {
  SEARCH_AUTOCOMPLETE_CATEGORY_LIMIT,
  SEARCH_AUTOCOMPLETE_FUZZY_MIN_LENGTH,
  SEARCH_AUTOCOMPLETE_INFIX_MIN_LENGTH,
  SEARCH_AUTOCOMPLETE_PRODUCT_LIMIT,
  SEARCH_AUTOCOMPLETE_VENDOR_LIMIT,
  SEARCH_SUGGESTION_TYPE,
} from '@core/constants/search';
import type { SearchSuggestionDto } from './search.dto';
import { buildAutocompleteLikePatterns } from './search.utils';

export interface SearchParams {
  term: string;
  categoryId?: string;
  vendorId?: string;
  minPrice?: number;
  maxPrice?: number;
  limit: number;
  offset: number;
}

export interface SearchResultRow {
  id: string;
  name: string;
  basePrice: string;
  compareAtPrice: string | null;
  brand: string | null;
  categoryId: string;
  rank: number;
  slug: string;
  description: string;
  imageUrl: string;
  avgRating: string;
  reviewCount: number;
  stock: number;
  defaultVariant: { id: string; stock: number } | null;
  vendor: {
    id: string;
    businessName: string;
    slug: string;
    logoUrl: string | null;
  };
}

interface ProductAutocompleteRow {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  imageUrl: string;
  sku: string | null;
}

interface VendorAutocompleteRow {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
}

interface CategoryAutocompleteRow {
  id: string;
  name: string;
  slug: string;
  path: string;
  imageUrl: string;
}

const liveProductFilters = `
  p."deletedAt" IS NULL
  AND p.status = :liveStatus
  AND v.status = :approvedStatus
  AND v."kycVerified" = true
  AND v."deletedAt" IS NULL
`;

const primaryImageLateral = `
  LEFT JOIN LATERAL (
    SELECT pi.url
    FROM product_images pi
    WHERE pi."productId" = p.id
      AND pi."deletedAt" IS NULL
    ORDER BY pi."isPrimary" DESC, pi."createdAt" ASC
    LIMIT 1
  ) img ON true
`;

/**
 * One deterministic "default" variant per product, matching the first entry the regular listing
 * endpoint's unfiltered `variants` association effectively returns — search results need at
 * least this much to enable the product card's quick-add-to-cart action, which otherwise stays
 * disabled for every card because the search response carried no variant data at all.
 */
const defaultVariantLateral = `
  LEFT JOIN LATERAL (
    SELECT json_build_object('id', sv.id, 'stock', sv.stock) AS variant
    FROM product_variants sv
    WHERE sv."productId" = p.id
      AND sv."deletedAt" IS NULL
    ORDER BY sv."createdAt" ASC
    LIMIT 1
  ) dv ON true
`;

const skuMatchExists = `
  EXISTS (
    SELECT 1
    FROM product_variants pv
    WHERE pv."productId" = p.id
      AND pv."deletedAt" IS NULL
      AND (
        lower(pv.sku) = lower(:term)
        OR pv.sku ILIKE :prefixPattern ESCAPE '\\'
      )
  )
`;

export class SearchRepository {
  async countSearchProducts(params: Omit<SearchParams, 'limit' | 'offset'>): Promise<number> {
    const { prefixPattern } = buildAutocompleteLikePatterns(params.term.trim());
    const [row] = await sequelize.query<{ total: number }>(
      `
      SELECT COUNT(*)::int AS total
      FROM products p
      JOIN vendors v ON v.id = p."vendorId" AND v."deletedAt" IS NULL
      , websearch_to_tsquery('english', :term) query
      WHERE (
          p.search_vector @@ query
          OR ${skuMatchExists}
        )
        AND ${liveProductFilters}
        AND (:categoryId::uuid IS NULL OR p."categoryId" = :categoryId::uuid)
        AND (:vendorId::uuid IS NULL OR p."vendorId" = :vendorId::uuid)
        AND (:minPrice::numeric IS NULL OR p."basePrice" >= :minPrice::numeric)
        AND (:maxPrice::numeric IS NULL OR p."basePrice" <= :maxPrice::numeric)
      `,
      {
        replacements: this.searchReplacements(params, prefixPattern),
        type: QueryTypes.SELECT,
      },
    );

    return row?.total ?? 0;
  }

  async searchProducts(params: SearchParams): Promise<SearchResultRow[]> {
    const { prefixPattern } = buildAutocompleteLikePatterns(params.term.trim());
    return sequelize.query<SearchResultRow>(
      `
      SELECT
        p.id,
        p.name,
        p."basePrice",
        p."compareAtPrice",
        p.brand,
        p."categoryId",
        p.slug,
        p.description,
        p."avgRating",
        COALESCE(img.url, '') AS "imageUrl",
        (
          SELECT COUNT(*)::int
          FROM reviews r
          WHERE r."productId" = p.id
            AND r.status = :reviewApprovedStatus
            AND r."deletedAt" IS NULL
        ) AS "reviewCount",
        (
          SELECT COALESCE(SUM(sv.stock), 0)::int
          FROM product_variants sv
          WHERE sv."productId" = p.id
            AND sv."deletedAt" IS NULL
        ) AS "stock",
        dv.variant AS "defaultVariant",
        json_build_object(
          'id', v.id,
          'businessName', v."businessName",
          'slug', v.slug,
          'logoUrl', v."logoUrl"
        ) AS vendor,
        CASE
          WHEN p.search_vector @@ query THEN ts_rank_cd(p.search_vector, query)
          ELSE 0.05
        END AS rank
      FROM products p
      JOIN vendors v ON v.id = p."vendorId" AND v."deletedAt" IS NULL
      ${primaryImageLateral}
      ${defaultVariantLateral}
      , websearch_to_tsquery('english', :term) query
      WHERE (
          p.search_vector @@ query
          OR ${skuMatchExists}
        )
        AND ${liveProductFilters}
        AND (:categoryId::uuid IS NULL OR p."categoryId" = :categoryId::uuid)
        AND (:vendorId::uuid IS NULL OR p."vendorId" = :vendorId::uuid)
        AND (:minPrice::numeric IS NULL OR p."basePrice" >= :minPrice::numeric)
        AND (:maxPrice::numeric IS NULL OR p."basePrice" <= :maxPrice::numeric)
      ORDER BY rank DESC, p.name ASC
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements: {
          ...this.searchReplacements(params, prefixPattern),
          reviewApprovedStatus: REVIEW_STATUS.APPROVED,
          limit: params.limit,
          offset: params.offset,
        },
        type: QueryTypes.SELECT,
      },
    );
  }

  async autocomplete(term: string): Promise<SearchSuggestionDto[]> {
    const normalized = term.trim();
    const patterns = buildAutocompleteLikePatterns(normalized);

    const [products, vendors, categories] = await Promise.all([
      this.autocompleteProducts(normalized, patterns),
      this.autocompleteVendors(normalized, patterns),
      this.autocompleteCategories(normalized, patterns),
    ]);

    return [...products, ...categories, ...vendors];
  }

  private async autocompleteProducts(
    term: string,
    patterns: ReturnType<typeof buildAutocompleteLikePatterns>,
  ): Promise<SearchSuggestionDto[]> {
    const rows = await sequelize.query<ProductAutocompleteRow>(
      `
      SELECT
        p.id,
        p.name,
        p.slug,
        p."basePrice",
        COALESCE(img.url, '') AS "imageUrl",
        (
          SELECT pv.sku
          FROM product_variants pv
          WHERE pv."productId" = p.id
            AND pv."deletedAt" IS NULL
            AND (
              lower(pv.sku) = lower(:term)
              OR pv.sku ILIKE :prefixPattern ESCAPE '\\'
            )
          ORDER BY
            CASE WHEN lower(pv.sku) = lower(:term) THEN 0 ELSE 1 END,
            char_length(pv.sku) ASC
          LIMIT 1
        ) AS sku,
        CASE
          WHEN p.name ILIKE :prefixPattern ESCAPE '\\' THEN 0
          WHEN EXISTS (
            SELECT 1 FROM product_variants pv
            WHERE pv."productId" = p.id
              AND pv."deletedAt" IS NULL
              AND lower(pv.sku) = lower(:term)
          ) THEN 0
          WHEN EXISTS (
            SELECT 1 FROM product_variants pv
            WHERE pv."productId" = p.id
              AND pv."deletedAt" IS NULL
              AND pv.sku ILIKE :prefixPattern ESCAPE '\\'
          ) THEN 1
          WHEN char_length(:term) >= :infixMinLen AND p.name ILIKE :infixPattern ESCAPE '\\' THEN 1
          ELSE 2
        END AS match_tier,
        GREATEST(
          word_similarity(:term, p.name),
          similarity(p.name, :term)
        ) AS score
      FROM products p
      JOIN vendors v ON v.id = p."vendorId" AND v."deletedAt" IS NULL
      ${primaryImageLateral}
      WHERE ${liveProductFilters}
        AND (
          p.name ILIKE :prefixPattern ESCAPE '\\'
          OR (
            char_length(:term) >= :infixMinLen
            AND p.name ILIKE :infixPattern ESCAPE '\\'
          )
          OR (
            char_length(:term) >= :fuzzyMinLen
            AND p.name % :term
          )
          OR ${skuMatchExists}
        )
      ORDER BY match_tier ASC, score DESC, char_length(p.name) ASC, p.name ASC
      LIMIT :limit
      `,
      {
        replacements: {
          term,
          prefixPattern: patterns.prefixPattern,
          infixPattern: patterns.infixPattern,
          infixMinLen: SEARCH_AUTOCOMPLETE_INFIX_MIN_LENGTH,
          fuzzyMinLen: SEARCH_AUTOCOMPLETE_FUZZY_MIN_LENGTH,
          limit: SEARCH_AUTOCOMPLETE_PRODUCT_LIMIT,
          liveStatus: PRODUCT_STATUS.LIVE,
          approvedStatus: VENDOR_STATUS.APPROVED,
        },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      type: SEARCH_SUGGESTION_TYPE.PRODUCT,
      id: row.id,
      name: row.name,
      slug: row.slug,
      basePrice: Number(row.basePrice ?? 0),
      imageUrl: row.imageUrl ?? '',
      sku: row.sku,
    }));
  }

  private async autocompleteVendors(
    term: string,
    patterns: ReturnType<typeof buildAutocompleteLikePatterns>,
  ): Promise<SearchSuggestionDto[]> {
    const rows = await sequelize.query<VendorAutocompleteRow>(
      `
      SELECT
        v.id,
        v."businessName" AS name,
        v.slug,
        COALESCE(v."logoUrl", '') AS "imageUrl",
        CASE
          WHEN v."businessName" ILIKE :prefixPattern ESCAPE '\\' THEN 0
          WHEN char_length(:term) >= :infixMinLen
            AND v."businessName" ILIKE :infixPattern ESCAPE '\\' THEN 1
          ELSE 2
        END AS match_tier,
        GREATEST(
          word_similarity(:term, v."businessName"),
          similarity(v."businessName", :term)
        ) AS score
      FROM vendors v
      WHERE v."deletedAt" IS NULL
        AND v.status = :approvedStatus
  AND v."kycVerified" = true
        AND (
          v."businessName" ILIKE :prefixPattern ESCAPE '\\'
          OR (
            char_length(:term) >= :infixMinLen
            AND v."businessName" ILIKE :infixPattern ESCAPE '\\'
          )
          OR (
            char_length(:term) >= :fuzzyMinLen
            AND v."businessName" % :term
          )
        )
      ORDER BY match_tier ASC, score DESC, char_length(v."businessName") ASC, v."businessName" ASC
      LIMIT :limit
      `,
      {
        replacements: {
          term,
          prefixPattern: patterns.prefixPattern,
          infixPattern: patterns.infixPattern,
          infixMinLen: SEARCH_AUTOCOMPLETE_INFIX_MIN_LENGTH,
          fuzzyMinLen: SEARCH_AUTOCOMPLETE_FUZZY_MIN_LENGTH,
          limit: SEARCH_AUTOCOMPLETE_VENDOR_LIMIT,
          approvedStatus: VENDOR_STATUS.APPROVED,
        },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      type: SEARCH_SUGGESTION_TYPE.VENDOR,
      id: row.id,
      name: row.name,
      slug: row.slug,
      imageUrl: row.imageUrl ?? '',
    }));
  }

  private async autocompleteCategories(
    term: string,
    patterns: ReturnType<typeof buildAutocompleteLikePatterns>,
  ): Promise<SearchSuggestionDto[]> {
    const rows = await sequelize.query<CategoryAutocompleteRow>(
      `
      WITH RECURSIVE cat_tree AS (
        SELECT
          c.id,
          c.name,
          c.slug,
          c."parentId",
          c."imageUrl",
          c.status,
          c."deletedAt",
          c.slug::text AS path
        FROM categories c
        WHERE c."parentId" IS NULL
          AND c."deletedAt" IS NULL

        UNION ALL

        SELECT
          c.id,
          c.name,
          c.slug,
          c."parentId",
          c."imageUrl",
          c.status,
          c."deletedAt",
          (ct.path || '/' || c.slug)::text AS path
        FROM categories c
        JOIN cat_tree ct ON c."parentId" = ct.id
        WHERE c."deletedAt" IS NULL
      )
      SELECT
        ct.id,
        ct.name,
        ct.slug,
        ct.path,
        COALESCE(ct."imageUrl", '') AS "imageUrl",
        CASE
          WHEN ct.name ILIKE :prefixPattern ESCAPE '\\' THEN 0
          WHEN char_length(:term) >= :infixMinLen AND ct.name ILIKE :infixPattern ESCAPE '\\' THEN 1
          ELSE 2
        END AS match_tier,
        GREATEST(
          word_similarity(:term, ct.name),
          similarity(ct.name, :term)
        ) AS score
      FROM cat_tree ct
      WHERE ct.status = :activeStatus
        AND (
          ct.name ILIKE :prefixPattern ESCAPE '\\'
          OR (
            char_length(:term) >= :infixMinLen
            AND ct.name ILIKE :infixPattern ESCAPE '\\'
          )
          OR (
            char_length(:term) >= :fuzzyMinLen
            AND ct.name % :term
          )
        )
      ORDER BY match_tier ASC, score DESC, char_length(ct.name) ASC, ct.name ASC
      LIMIT :limit
      `,
      {
        replacements: {
          term,
          prefixPattern: patterns.prefixPattern,
          infixPattern: patterns.infixPattern,
          infixMinLen: SEARCH_AUTOCOMPLETE_INFIX_MIN_LENGTH,
          fuzzyMinLen: SEARCH_AUTOCOMPLETE_FUZZY_MIN_LENGTH,
          limit: SEARCH_AUTOCOMPLETE_CATEGORY_LIMIT,
          activeStatus: CATEGORY_STATUS.ACTIVE,
        },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      type: SEARCH_SUGGESTION_TYPE.CATEGORY,
      id: row.id,
      name: row.name,
      slug: row.slug,
      path: row.path,
      imageUrl: row.imageUrl ?? '',
    }));
  }

  private searchReplacements(
    params: Omit<SearchParams, 'limit' | 'offset'>,
    prefixPattern: string,
  ) {
    return {
      term: params.term,
      prefixPattern,
      liveStatus: PRODUCT_STATUS.LIVE,
      approvedStatus: VENDOR_STATUS.APPROVED,
      categoryId: params.categoryId ?? null,
      vendorId: params.vendorId ?? null,
      minPrice: params.minPrice ?? null,
      maxPrice: params.maxPrice ?? null,
    };
  }
}

export const searchRepository = new SearchRepository();
