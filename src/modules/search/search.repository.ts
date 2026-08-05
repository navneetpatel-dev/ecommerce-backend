import { sequelize } from '@database/models';
import { QueryTypes } from 'sequelize';

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
}

export class SearchRepository {
  async searchProducts(params: SearchParams): Promise<SearchResultRow[]> {
    return sequelize.query<SearchResultRow>(
      `
      SELECT 
        p.id, 
        p.name, 
        p."basePrice", 
        p.slug,
        p.description,
        ts_rank_cd(p.search_vector, query) AS rank
      FROM products p, websearch_to_tsquery('english', :term) query
      WHERE p.search_vector @@ query
        AND p.status = 'LIVE'
        AND (:categoryId::uuid IS NULL OR p.category_id = :categoryId::uuid)
        AND (:vendorId::uuid IS NULL OR p.vendor_id = :vendorId::uuid)
        AND (:minPrice::numeric IS NULL OR p."basePrice" >= :minPrice::numeric)
        AND (:maxPrice::numeric IS NULL OR p."basePrice" <= :maxPrice::numeric)
      ORDER BY rank DESC
      LIMIT :limit OFFSET :offset
      `,
      {
        replacements: {
          term: params.term,
          categoryId: params.categoryId ?? null,
          vendorId: params.vendorId ?? null,
          minPrice: params.minPrice ?? null,
          maxPrice: params.maxPrice ?? null,
          limit: params.limit,
          offset: params.offset,
        },
        type: QueryTypes.SELECT,
      }
    );
  }

  async autocomplete(term: string): Promise<{ id: string; name: string }[]> {
    return sequelize.query(
      `
      SELECT id, name
      FROM products
      WHERE name % :term AND status = 'LIVE'
      ORDER BY similarity(name, :term) DESC
      LIMIT 10
      `,
      { replacements: { term }, type: QueryTypes.SELECT }
    );
  }
}

export const searchRepository = new SearchRepository();
