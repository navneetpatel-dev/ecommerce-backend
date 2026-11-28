import { parseCsv } from '@core/csv/parseCsv';

/** CreateProductSchema fields a flat CSV row can realistically carry (scalar only). */
export const BULK_IMPORT_CSV_FIELDS = [
  'categoryId',
  'name',
  'description',
  'basePrice',
  'compareAtPrice',
  'brand',
  'warrantyMonths',
  'warrantyType',
  'hsnCode',
  'seoTitle',
  'seoDescription',
  'videoUrl',
  'sizeChartUrl',
  'codEnabled',
] as const;

const NUMERIC_FIELDS = new Set(['basePrice', 'compareAtPrice', 'warrantyMonths']);
const BOOLEAN_FIELDS = new Set(['codEnabled']);

export type BulkImportCsvRow = Record<string, unknown>;

/**
 * Parses raw CSV text into row objects keyed by header name, coercing known
 * numeric/boolean columns. Unknown columns (e.g. tags, images) are dropped —
 * arrays/objects and image binaries can't be represented in a flat CSV cell.
 */
export function parseProductsCsv(text: string): BulkImportCsvRow[] {
  const [headers, ...lines] = parseCsv(text);
  if (!headers) return [];

  const allowed = new Set<string>(BULK_IMPORT_CSV_FIELDS);

  return lines.map((cells) => {
    const row: BulkImportCsvRow = {};
    headers.forEach((header, index) => {
      if (!allowed.has(header)) return; // ignore unsupported/unknown columns
      const raw = cells[index]?.trim() ?? '';
      if (raw === '') return; // let zod defaults / required-field errors apply
      if (NUMERIC_FIELDS.has(header)) {
        const num = Number(raw);
        row[header] = Number.isNaN(num) ? raw : num;
      } else if (BOOLEAN_FIELDS.has(header)) {
        row[header] = raw.toLowerCase() === 'true' || raw === '1';
      } else {
        row[header] = raw;
      }
    });
    return row;
  });
}
