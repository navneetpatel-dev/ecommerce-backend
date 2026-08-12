import { z } from 'zod';
import { pageLimitQuerySchema } from '@core/http/pagination';
import {
  SEARCH_AUTOCOMPLETE_MAX_QUERY_LENGTH,
  SEARCH_AUTOCOMPLETE_MIN_QUERY_LENGTH,
} from '@core/constants/search';

export const SearchProductsQuerySchema = pageLimitQuerySchema.extend({
  q: z.string().trim().min(1).max(SEARCH_AUTOCOMPLETE_MAX_QUERY_LENGTH),
  categoryId: z.string().uuid().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
});

export const AutocompleteQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(SEARCH_AUTOCOMPLETE_MIN_QUERY_LENGTH)
    .max(SEARCH_AUTOCOMPLETE_MAX_QUERY_LENGTH),
});

export type SearchProductsQuery = z.infer<typeof SearchProductsQuerySchema>;
export type AutocompleteQuery = z.infer<typeof AutocompleteQuerySchema>;

export type SearchSuggestionDto = {
  id: string;
  name: string;
  slug: string;
  basePrice: number;
  imageUrl: string;
};
