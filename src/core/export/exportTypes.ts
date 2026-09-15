export type ExportColumnFormat = 'string' | 'number' | 'currency' | 'points' | 'date' | 'percent';

/** Already-resolved column — no i18n/label-key lookup left to do inside the engine. */
export type ExportColumn = {
  key: string;
  label: string;
  format?: ExportColumnFormat;
};

export type ExportFileFormat = 'csv' | 'xlsx' | 'pdf';

/**
 * Anything that wants an async export implements this. `rows` is an async
 * generator so the engine never holds more than one chunk in memory —
 * mirrors the existing `createReportRowIterator` contract exactly.
 */
export type ExportSource = {
  columns: ExportColumn[];
  title: string;
  /** Best-effort total for progress percentage; omit if unknown (progress falls back to row count only). */
  estimateTotal?: () => Promise<number | null>;
  rows: () => AsyncGenerator<Record<string, unknown>[], void, unknown>;
};

/**
 * No `tempPath` here on purpose (an earlier draft of this plan had one —
 * see Step 03's design note). Writers now write directly into a
 * caller-supplied `NodeJS.WritableStream` that is simultaneously being
 * read by the S3 upload, so there is nothing on local disk to describe.
 */
export type ExportArtifact = {
  contentType: string;
  byteSize: number;
};

export interface ExportWriter {
  writeHeader(): Promise<void>;
  writeRows(rows: Record<string, unknown>[]): Promise<void>;
  /** Ends the writer's output stream and resolves once every byte has been flushed into it. */
  finalize(): Promise<ExportArtifact>;
  dispose(): Promise<void>;
}

export function contentTypeForExportFormat(format: ExportFileFormat): string {
  if (format === 'csv') return 'text/csv; charset=utf-8';
  if (format === 'pdf') return 'application/pdf';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
