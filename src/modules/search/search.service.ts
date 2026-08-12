import { searchRepository } from './search.repository';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import type { SearchProductsQuery } from './search.dto';

export class SearchService {
  async searchProducts(query: SearchProductsQuery) {
    const offset = paginationOffset(query.page, query.limit);
    const filters = {
      term: query.q,
      categoryId: query.categoryId,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
    };

    const [rows, total] = await Promise.all([
      searchRepository.searchProducts({ ...filters, limit: query.limit, offset }),
      searchRepository.countSearchProducts(filters),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        basePrice: Number(row.basePrice ?? 0),
        imageUrl: row.imageUrl ?? '',
        description: row.description,
        rank: row.rank,
      })),
      pagination: buildPaginationMeta(total, query.page, query.limit),
    };
  }

  autocomplete(term: string) {
    return searchRepository.autocomplete(term);
  }
}

export const searchService = new SearchService();
