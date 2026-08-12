import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { paginationMetaBag } from '@core/http/pagination';
import { AutocompleteQuerySchema, SearchProductsQuerySchema } from './search.dto';
import { searchService } from './search.service';

export const searchProducts = asyncHandler(async (req: Request, res: Response) => {
  const query = SearchProductsQuerySchema.parse(req.query);
  const result = await searchService.searchProducts(query);
  res.json(ok(result.items, paginationMetaBag(result.pagination)));
});

export const autocomplete = asyncHandler(async (req: Request, res: Response) => {
  const { q } = AutocompleteQuerySchema.parse(req.query);
  const results = await searchService.autocomplete(q);
  res.json(ok(results));
});
