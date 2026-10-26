import type { KeysetOrderCol } from '../engine/export/keysetSqlQuery';

/**
 * Export sort keys for the finance reports. Each is unique per row (every column the
 * query groups by), so paging by keyset never skips or repeats a row at a chunk edge.
 */
export const GST_TCS_KEYSET: KeysetOrderCol[] = [
  { column: 'groupType', direction: 'ASC' },
  { column: 'period', direction: 'DESC' },
  { column: 'state', direction: 'ASC' },
  { column: 'vendorId', direction: 'ASC' },
  { column: 'section', direction: 'ASC' },
  { column: 'entryType', direction: 'ASC' },
];

export const HSN_SALES_KEYSET: KeysetOrderCol[] = [
  { column: 'supplierGstin', direction: 'ASC' },
  { column: 'supplierName', direction: 'ASC' },
  { column: 'hsnCode', direction: 'ASC' },
  { column: 'gstRate', direction: 'ASC' },
];

export const GMV_KEYSET: KeysetOrderCol[] = [
  { column: 'gmvPaise', direction: 'DESC' },
  { column: 'vendorId', direction: 'ASC' },
];

export const GMV_CATEGORY_KEYSET: KeysetOrderCol[] = [
  { column: 'gmvPaise', direction: 'DESC' },
  { column: 'vendorId', direction: 'ASC' },
  { column: 'categoryId', direction: 'ASC' },
];
