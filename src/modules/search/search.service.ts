import { searchRepository } from './search.repository';
import type { SearchParams } from './search.repository';

export class SearchService {
  async searchProducts(params: SearchParams) {
    return searchRepository.searchProducts(params);
  }

  async autocomplete(term: string) {
    return searchRepository.autocomplete(term);
  }
}

export const searchService = new SearchService();
