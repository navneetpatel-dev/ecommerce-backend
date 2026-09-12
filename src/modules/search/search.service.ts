import { searchRepository } from './search.repository';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { roundMoney } from '@modules/pricing/money';
import { productDiscountPercent, productShowMrp } from '@modules/pricing/displayMoney';
import type { SearchProductsQuery } from './search.dto';

export class SearchService {
  async searchProducts(query: SearchProductsQuery) {
    const offset = paginationOffset(query.page, query.limit);
    const filters = {
      term: query.q,
      categoryId: query.categoryId,
      vendorId: query.vendorId,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
    };

    const [rows, total] = await Promise.all([
      searchRepository.searchProducts({ ...filters, limit: query.limit, offset }),
      searchRepository.countSearchProducts(filters),
    ]);

    return {
      items: rows.map((row) => {
        const basePrice = roundMoney(row.basePrice ?? 0);
        const compareAtPrice =
          row.compareAtPrice != null && row.compareAtPrice !== ''
            ? roundMoney(row.compareAtPrice)
            : null;

        return {
          id: row.id,
          name: row.name,
          slug: row.slug,
          basePrice,
          compareAtPrice,
          discountPercent: productDiscountPercent(basePrice, compareAtPrice),
          showMrp: productShowMrp(basePrice, compareAtPrice),
          brand: row.brand ?? null,
          avgRating: Number(row.avgRating ?? 0),
          reviewCount: Number(row.reviewCount ?? 0),
          imageUrl: row.imageUrl ?? '',
          stock: Number(row.stock ?? 0),
          // Enables the product card's quick-add action — without at least one variant id, the
          // card has no id to add to cart and quick-add silently disables itself for every result.
          variants: row.defaultVariant
            ? [{ id: row.defaultVariant.id, stock: Number(row.defaultVariant.stock ?? 0) }]
            : [],
          vendor: row.vendor,
          categoryId: row.categoryId,
          description: row.description,
          rank: row.rank,
        };
      }),
      pagination: buildPaginationMeta(total, query.page, query.limit),
    };
  }

  autocomplete(term: string) {
    return searchRepository.autocomplete(term);
  }
}

export const searchService = new SearchService();
