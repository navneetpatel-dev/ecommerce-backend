/** Search / autocomplete tuning — keep in sync with web search feature constants. */
export const SEARCH_AUTOCOMPLETE_LIMIT = 8;
export const SEARCH_AUTOCOMPLETE_MIN_QUERY_LENGTH = 2;
export const SEARCH_AUTOCOMPLETE_MAX_QUERY_LENGTH = 100;
/** Infix / fuzzy trigram match only at this length+ (prefix always applies). */
export const SEARCH_AUTOCOMPLETE_INFIX_MIN_LENGTH = 3;
export const SEARCH_AUTOCOMPLETE_FUZZY_MIN_LENGTH = 3;

/** Mixed autocomplete allocation (products + vendors + categories ≈ LIMIT). */
export const SEARCH_AUTOCOMPLETE_PRODUCT_LIMIT = 5;
export const SEARCH_AUTOCOMPLETE_VENDOR_LIMIT = 2;
export const SEARCH_AUTOCOMPLETE_CATEGORY_LIMIT = 2;

export const SEARCH_SUGGESTION_TYPE = {
  PRODUCT: 'product',
  VENDOR: 'vendor',
  CATEGORY: 'category',
} as const;

export type SearchSuggestionType =
  (typeof SEARCH_SUGGESTION_TYPE)[keyof typeof SEARCH_SUGGESTION_TYPE];

export const SEARCH_SUGGESTION_TYPE_VALUES = Object.values(SEARCH_SUGGESTION_TYPE) as [
  SearchSuggestionType,
  ...SearchSuggestionType[],
];
