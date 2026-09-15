import { createCsvOrXlsxWriter } from './csvXlsxWriters';
import { ChunkedPdfWriter } from './ChunkedPdfWriter';
import { exportConfig } from '../exportConfig';
import type { ExportColumn, ExportFileFormat, ExportWriter } from '../exportTypes';

export function createExportWriter(
  format: ExportFileFormat,
  columns: ExportColumn[],
  title: string,
  sink: NodeJS.WritableStream,
): ExportWriter {
  if (format === 'pdf') return new ChunkedPdfWriter(sink, columns, title, exportConfig.chunkSize);
  return createCsvOrXlsxWriter(format, columns, title, sink);
}

export { ByteCountingPassThrough } from './byteCountingStream';
export type { ExportColumn, ExportArtifact, ExportWriter, ExportFileFormat, ExportSource } from '../exportTypes';
