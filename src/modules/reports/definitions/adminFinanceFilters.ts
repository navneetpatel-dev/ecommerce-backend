import type { ReportFilters } from '../engine/types';

export function resolveVendorId(filters: ReportFilters): string | null {
  return filters.scopedVendorId ?? filters.vendorId ?? null;
}

export function sqlReplacements(filters: ReportFilters): Record<string, unknown> {
  return {
    from: filters.from,
    to: filters.to,
    vendorId: resolveVendorId(filters),
    categoryId: filters.categoryId ?? null,
    status: filters.status ?? null,
  };
}
