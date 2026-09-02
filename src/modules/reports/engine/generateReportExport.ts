import fsp from 'node:fs/promises';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { getReportDefinition } from './reportRegistry';
import { buildReportFilename } from './excelExporter';
import {
  contentTypeForFormat,
  extensionForFormat,
  type ReportExportFormat,
} from './csvExporter';
import { assertReportRange } from './queryHelpers';
import type { ReportFilters } from './types';
import { createReportRowIterator } from './export/ReportRowIterator';
import { createStreamingWriter } from './export/StreamingExportWriter';
import { reportExportConfig } from '../reportExportConfig';
import { emitReportExportMetric } from '../reportExportMetrics';
import type { ReportActor } from './reportEngine.types';
import { actorCanAccess, isVendorStaff, resolveFiltersForActor } from './reportEngine.helpers';

export type DirectExportResult = {
  buffer: Buffer;
  filename: string;
  contentType: string;
  rowCount: number;
};

export async function generateReportExport(
  actor: ReportActor,
  reportType: string,
  rawFilters: ReportFilters,
  exportFormat: ReportExportFormat = 'xlsx',
): Promise<DirectExportResult> {
  const def = getReportDefinition(reportType);
  if (!def) throw new NotFoundError(ERROR_MESSAGES.REPORT_NOT_FOUND);
  if (!actorCanAccess(actor.permissions, actor.roleName, def.permissions)) {
    throw new ForbiddenError(ERROR_MESSAGES.REPORT_FORBIDDEN);
  }
  if (isVendorStaff(actor.permissions, actor.roleName) && def.financial) {
    throw new ForbiddenError(ERROR_MESSAGES.REPORT_FORBIDDEN);
  }
  assertReportRange(rawFilters);
  const filters = resolveFiltersForActor(actor, rawFilters, def.vendorScoped);
  if (def.audience === 'customer') filters.userId = actor.id;

  const startedAt = Date.now();
  let writer: ReturnType<typeof createStreamingWriter> | null = null;

  try {
    writer = createStreamingWriter(exportFormat, def.columns, def.type);
    await writer.writeHeader();

    let rowCount = 0;
    const maxRows = reportExportConfig.maxRows;
    for await (const chunk of createReportRowIterator(def, filters)) {
      if (maxRows > 0 && rowCount + chunk.length > maxRows) {
        throw new ValidationError(
          `Export exceeds maximum row limit (${maxRows.toLocaleString()}) — narrow the date range`,
        );
      }
      rowCount += chunk.length;
      await writer.writeRows(chunk);
    }

    const artifact = await writer.finalize();
    const ext = extensionForFormat(exportFormat);
    const filename = buildReportFilename(def.type, filters.from, filters.to, ext);
    const buffer = await fsp.readFile(artifact.tempPath);

    emitReportExportMetric({
      outcome: 'completed',
      reportType: def.type,
      format: exportFormat,
      rowCount,
      durationMs: Date.now() - startedAt,
      byteSize: buffer.length,
    });

    return {
      buffer,
      filename,
      contentType: contentTypeForFormat(exportFormat),
      rowCount,
    };
  } catch (err) {
    emitReportExportMetric({
      outcome: 'failed',
      reportType: def.type,
      format: exportFormat,
      durationMs: Date.now() - startedAt,
    });
    throw err;
  } finally {
    if (writer) await writer.dispose().catch(() => undefined);
  }
}
