/** Builds safe, unique, human-readable download filenames for exports and PDFs. */

export function sanitizeFilenameSegment(value: string, maxLen = 80): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return slug || 'document';
}

export function formatDateForFilename(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown-date';
  return date.toISOString().slice(0, 10);
}

export function formatDateRangeForFilename(
  from: Date | string,
  to: Date | string,
): string {
  return `${formatDateForFilename(from)}_to_${formatDateForFilename(to)}`;
}

export function buildUniqueTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Dated export: `{documentKey}[_{suffix}]_{from}_to_{to}_{timestamp}.{ext}` */
export function buildDatedExportFilename(
  documentKey: string,
  from: Date | string,
  to: Date | string,
  extension: string,
  suffix?: string | null,
): string {
  const key = sanitizeFilenameSegment(documentKey);
  const range = formatDateRangeForFilename(from, to);
  const stamp = buildUniqueTimestamp();
  const ext = extension.replace(/^\./, '');
  const suffixPart = suffix ? `_${sanitizeFilenameSegment(suffix)}` : '';
  return `${key}${suffixPart}_${range}_${stamp}.${ext}`;
}

/** GST tax invoice PDF: `gst-tax-invoice_{vendor}_{invoiceNumber}.pdf` */
export function buildTaxInvoicePdfFilename(
  invoiceNumber: string,
  vendorSlug?: string | null,
): string {
  const invoice = sanitizeFilenameSegment(invoiceNumber.replace(/\//g, '-'));
  const vendor = vendorSlug
    ? `_${sanitizeFilenameSegment(vendorSlug, 24)}`
    : '';
  return `gst-tax-invoice${vendor}_${invoice}.pdf`;
}

/** Report engine spreadsheet export filename. */
export function buildReportEngineExportFilename(
  reportType: string,
  from: Date | string,
  to: Date | string,
): string {
  return buildDatedExportFilename(reportType, from, to, 'xlsx');
}

export function documentKeyToPdfTitle(documentKey: string): string {
  return documentKey
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
