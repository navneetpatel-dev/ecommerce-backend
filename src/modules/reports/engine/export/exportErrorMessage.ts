import { ERROR_MESSAGES } from '@core/constants/errors';

const INTERNAL_PATTERNS = [
  /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i,
  /Sequelize/i,
  /ECONNREFUSED/i,
  /AccessDenied/i,
  /arn:aws:/i,
  /node_modules/i,
  /at\s+[\w./<>-]+\(\d+:\d+\)/,
];

/** Safe client-facing export failure text — never leak SQL/S3/stack details. */
export function sanitizeExportErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return ERROR_MESSAGES.REPORT_EXPORT_NOT_READY;
  if (INTERNAL_PATTERNS.some((p) => p.test(trimmed))) {
    return 'Export failed — try again with a narrower date range';
  }
  if (trimmed.length > 200) return 'Export failed — try again with a narrower date range';
  return trimmed;
}
