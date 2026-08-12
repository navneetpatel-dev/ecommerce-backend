import { Router } from 'express';
import { validate } from '@middleware/validate.middleware';
import { AutocompleteQuerySchema, SearchProductsQuerySchema } from './search.dto';
import * as searchController from './search.controller';

const router = Router();

router.get('/', validate(SearchProductsQuerySchema, 'query'), searchController.searchProducts);
router.get(
  '/autocomplete',
  validate(AutocompleteQuerySchema, 'query'),
  searchController.autocomplete,
);

export default router;
