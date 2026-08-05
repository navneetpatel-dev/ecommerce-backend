// Search module - Product search with PostgreSQL full-text search
import { Router } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { z } from 'zod';
import { validate } from '@middleware/validate.middleware';
import { searchService } from './search.service';

const SearchProductsSchema = z.object({
  q: z.string().min(1),
  categoryId: z.string().uuid().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const AutocompleteSchema = z.object({
  q: z.string().min(1),
});

const router = Router();

router.get('/', validate(SearchProductsSchema, 'query'), asyncHandler(async (req, res) => {
  const query = SearchProductsSchema.parse(req.query);
  const offset = (query.page - 1) * query.limit;
  
  const results = await searchService.searchProducts({
    term: query.q,
    categoryId: query.categoryId,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    limit: query.limit,
    offset,
  });
  
  res.json(ok(results));
}));

router.get('/autocomplete', validate(AutocompleteSchema, 'query'), asyncHandler(async (req, res) => {
  const { q } = AutocompleteSchema.parse(req.query);
  const results = await searchService.autocomplete(q);
  res.json(ok(results));
}));

export default router;
