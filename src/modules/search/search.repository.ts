import { sequelize } from '@database/models';
import { QueryTypes } from 'sequelize';
import { PRODUCT_STATUS, VENDOR_STATUS } from '@core/constants/statuses';
import {
  SEARCH_AUTOCOMPLETE_FUZZY_MIN_LENGTH,
  SEARCH_AUTOCOMPLETE_INFIX_MIN_LENGTH,
  SEARCH_AUTOCOMPLETE_LIMIT,
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
  rank: number;
  slug: string;
  description: string;
  imageUrl: string;
}

interface AutocompleteRow {
  id: string;
  name: string;
  slug: string;
  basePrice: string;
  imageUrl: string;
}

const liveProductFilters = `
  p."deletedAt" IS NULL
  AND p.status = :liveStatus
  AND v.status = :approvedStatus
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

export class SearchRepository {
  async countSearchProducts(params: Omit<SearchParams, 'limit' | 'offset'>): Promise<number> {
    const [row] = await sequelize.query<{ total: number }>(
      `
      SELECT COUNT(*)::int AS total
      FROM products p
      JOIN vendors v ON v.id = p."vendorId" AND v."deletedAt" IS NULL
      , websearch_to_tsquery('english', :term) query
      WHERE p.search_vector @@ query
        AND ${liveProductFilters}
        AND (:categoryId::uuid IS NULL OR p."categoryId" = :categoryId::uuid)
        AND (:vendorId::uuid IS NULL OR p."vendorId" = :vendorId::uuid)
        AND (:minPrice::numeric IS NULL OR p."basePrice" >= :minPrice::numeric)
        AND (:maxPrice::numeric IS NULL OR p."basePrice" <= :maxPrice::numeric)
      `,
      {
        replacements: this.searchReplacements(params),
        type: QueryTypes.SELECT,
      },
    );

    return row?.total ?? 0;
  }

  async searchProducts(params: SearchParams): Promise<SearchResultRow[]> {
    return sequelize.query<SearchResultRow>(
      `
      SELECT
        p.id,
        p.name,
        p."basePrice",
        p.slug,
        p.description,
        COALESCE(img.url, '') AS "imageUrl",
        ts_rank_cd(p.search_vector, query) AS rank
      FROM products p
      JOIN vendors v ON v.id = p."vendorId" AND v."deletedAt" IS NULL
      ${primaryImageLateral}
      , websearch_to_tsquery('english', :term) query
      WHERE p.search_vector @@ query
        AND ${liveProductFilters}
        AND (:categoryId::uuid IS NULL OR p."categoryId" = :categoryId::uuid)
        AND (:vendorId::uuid IS NULL OR p."vendorId" = :vendorId::uuid)
        AND (:minPrice::numeric IS NULL OR p."basePrice" >= :minPrice::numeric)
        AND (:maxPrice::numeric IS NULL OR p."basePrice" <= :maxPrice::numeric)
      ORDER BY rank DESC
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements: {
          ...this.searchReplacements(params),
          limit: params.limit,
          offset: params.offset,
        },
        type: QueryTypes.SELECT,
      },
    );
  }

  async autocomplete(term: string, limit = SEARCH_AUTOCOMPLETE_LIMIT): Promise<SearchSuggestionDto[]> {
    const normalized = term.trim();
    const { prefixPattern, infixPattern } = buildAutocompleteLikePatterns(normalized);

    const rows = await sequelize.query<AutocompleteRow>(
      `
      SELECT
        p.id,
        p.name,
        p.slug,
        p."basePrice",
        COALESCE(img.url, '') AS "imageUrl",
        CASE
          WHEN p.name ILIKE :prefixPattern ESCAPE '\\' THEN 0
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
        )
      ORDER BY match_tier ASC, score DESC, char_length(p.name) ASC, p.name ASC
      LIMIT :limit
      `,
      {
        replacements: {
          term: normalized,
          prefixPattern,
          infixPattern,
          infixMinLen: SEARCH_AUTOCOMPLETE_INFIX_MIN_LENGTH,
          fuzzyMinLen: SEARCH_AUTOCOMPLETE_FUZZY_MIN_LENGTH,
          limit,
          liveStatus: PRODUCT_STATUS.LIVE,
          approvedStatus: VENDOR_STATUS.APPROVED,
        },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      basePrice: Number(row.basePrice ?? 0),
      imageUrl: row.imageUrl ?? '',
    }));
  }

  private searchReplacements(params: Omit<SearchParams, 'limit' | 'offset'>) {
    return {
      term: params.term,
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
