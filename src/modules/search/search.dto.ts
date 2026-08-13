import { z } from 'zod';
import { pageLimitQuerySchema } from '@core/http/pagination';
import {
  SEARCH_AUTOCOMPLETE_MAX_QUERY_LENGTH,
  SEARCH_AUTOCOMPLETE_MIN_QUERY_LENGTH,
  SEARCH_SUGGESTION_TYPE_VALUES,
  type SearchSuggestionType,
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
  type: SearchSuggestionType;
  id: string;
  name: string;
  slug: string;
  /** Slash-separated category slug path for nested URLs. */
  path?: string | null;
  basePrice?: number;
  imageUrl?: string;
  /** Present when a product match came from a variant SKU. */
  sku?: string | null;
};

export const SearchSuggestionTypeSchema = z.enum(SEARCH_SUGGESTION_TYPE_VALUES);
