import type { PermissionKey } from '@core/permissions/permissionKeys';

export type ReportAudience =
  | 'admin_finance'
  | 'admin_ops'
  | 'admin_catalog'
  | 'vendor_owner'
  | 'vendor_staff'
  | 'customer';

export type ReportColumnFormat = 'string' | 'number' | 'currency' | 'points' | 'date' | 'percent';

export type ReportColumn = {
  key: string;
  /** Key into REPORT_COLUMN_LABELS (BE) / LABELS (FE). */
  labelKey: string;
  format?: ReportColumnFormat;
};

export type ReportFilters = {
  from: Date;
  to: Date;
  vendorId?: string | null;
  categoryId?: string | null;
  status?: string | null;
  bornBy?: string | null;
  page?: number;
  limit?: number;
  /** Hard-scoped vendor id from auth (vendor roles). */
  scopedVendorId?: string | null;
  /** Authenticated user id (customer reports). */
  userId?: string | null;
  /** @internal — skip COUNT during export pagination when total is known. */
  _exportSkipCount?: boolean;
  _exportKnownTotal?: number;
};

export type ReportQueryResult = {
  rows: Record<string, unknown>[];
  total: number;
  meta?: Record<string, unknown>;
};

export type ReportExportPage = {
  rows: Record<string, unknown>[];
  nextCursor: { values: unknown[] } | null;
};

export type ReportDefinition = {
  type: string;
  labelKey: string;
  audience: ReportAudience;
  /** Caller needs ANY of these permissions (SUPER_ADMIN always allowed). Empty = authenticated only. */
  permissions: PermissionKey[];
  /** When true, engine forces filters.vendorId = scopedVendorId. */
  vendorScoped: boolean;
  /** Financial reports — blocked for vendor staff even if they somehow get a type. */
  financial: boolean;
  columns: ReportColumn[];
  query: (filters: ReportFilters) => Promise<ReportQueryResult>;
  /** Optional keyset/stream page for large exports (avoids deep OFFSET). */
  exportQuery?: (
    filters: ReportFilters,
    cursor: { values: unknown[] } | null,
    limit: number,
  ) => Promise<ReportExportPage>;
};

export const REPORT_EXPORT_PAGE_SIZE = 2_000;
