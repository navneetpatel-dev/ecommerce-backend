import { ReportExportLog } from '@database/models/reportExportLog.model';

/** Keeps PROCESSING exports alive past stale-processing cutoff while worker streams. */
export async function touchExportHeartbeat(exportLogId: string): Promise<void> {
  await ReportExportLog.update(
    { updatedAt: new Date() },
    { where: { id: exportLogId, status: 'PROCESSING' } },
  );
}

/** Finalize only if this worker still owns the export (status PROCESSING). */
export async function completeExportIfProcessing(
  exportLogId: string,
  values: Record<string, unknown>,
): Promise<boolean> {
  const [updated] = await ReportExportLog.update(values, {
    where: { id: exportLogId, status: 'PROCESSING' },
  });
  return updated > 0;
}

export async function failExportIfProcessing(
  exportLogId: string,
  errorMessage: string,
): Promise<boolean> {
  const [updated] = await ReportExportLog.update(
    { status: 'FAILED', errorMessage },
    { where: { id: exportLogId, status: 'PROCESSING' } },
  );
  return updated > 0;
}
