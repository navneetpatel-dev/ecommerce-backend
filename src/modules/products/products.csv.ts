/**
 * Minimal CSV parsing for POST /products/bulk-import.
 *
 * No CSV-parsing library is a dependency of this backend today (checked package.json),
 * so this is a deliberately simple line/comma splitter rather than a full RFC 4180
 * parser. LIMITATION: it does not support embedded commas, quoted fields, or escaped
 * quotes/newlines within a cell. This is acceptable for a first cut given typical
 * vendor product CSVs (name/description/price/category columns) are simple
 * comma-separated rows without embedded commas or quotes. If richer CSVs are needed
 * later, swap this module for a real parser (e.g. `csv-parse`).
 */

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

function splitLine(line: string): string[] {
  return line.split(',').map((cell) => cell.trim());
}

/**
 * Parses raw CSV text into row objects keyed by header name, coercing known
 * numeric/boolean columns. Unknown columns (e.g. tags, images) are dropped —
 * arrays/objects and image binaries can't be represented in a flat CSV cell.
 */
export function parseProductsCsv(text: string): BulkImportCsvRow[] {
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const headers = splitLine(lines[0]!).map((header) => header.trim());
  const allowed = new Set<string>(BULK_IMPORT_CSV_FIELDS);

  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
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
