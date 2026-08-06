import { z } from 'zod';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@core/constants/http';

export type PaginationMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

/** Shared page/limit query fragment for list endpoints. */
export const pageLimitQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

export function paginationOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  return {
    total,
    page,
    limit,
    totalPages: limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1,
  };
}

/** Meta bag to pass into `ok(rows, paginationMetaBag(...))`. */
export function paginationMetaBag(meta: PaginationMeta): { pagination: PaginationMeta } {
  return { pagination: meta };
}
