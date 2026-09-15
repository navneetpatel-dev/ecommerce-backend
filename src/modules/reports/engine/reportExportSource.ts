import { getReportDefinition } from './reportRegistry';
import { resolveReportColumnLabel } from '../reports.constants';
import { assertReportRange } from './queryHelpers';
import { createReportRowIterator, countReportRows } from './export/ReportRowIterator';
import { actorCanAccess, isVendorStaff, resolveFiltersForActor } from './reportEngine.helpers';
import { documentKeyToPdfTitle } from '@core/export/exportFilenames';
import type { ExportSource, ExportActor } from '@core/export';
import { registerExportDomain } from '@core/export';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import type { ReportFilters } from './types';

/**
 * `POST /api/exports`'s body schema (Step 10) deliberately accepts
 * `filters: z.record(z.unknown())` — a generic, opaque bag, since the
 * `exports` module is domain-agnostic and has no business knowing that a
 * `report` export specifically needs `from`/`to` dates. That's the right
 * call architecturally, but it has a real cost worth naming: unlike the
 * *old* synchronous endpoints (whose Zod schemas — `EngineReportQuerySchema`
 * etc. — validate `from`/`to` as real dates at the HTTP layer, failing the
 * request immediately with a clean 400), a malformed `from`/`to` on this
 * path isn't caught until a worker picks the job up — it fails later, as a
 * job transitioning QUEUED → PROCESSING → FAILED instead of the POST
 * itself being rejected. That slower failure path is an accepted tradeoff
 * of keeping the engine generic (see Step 24's catalog); what would NOT be
 * acceptable is for it to fail *unclearly*. Without the check below,
 * `raw.from` being `undefined` (or any non-date-parseable value) produces
 * an `Invalid Date`, and `Invalid Date > Invalid Date` evaluates to
 * `false` — so `assertReportRange`'s own range check silently passes
 * straight through an invalid range instead of catching it, and the
 * failure only surfaces later as an opaque, unrelated error several layers
 * down (a DB driver rejecting the malformed date, or worse, being coerced
 * into some default). Catching it explicitly, right here, with a real
 * `ValidationError`, is what keeps the eventual `export:failed` message
 * specific ("Invalid date range") instead of generic.
 */
function toReportFilters(raw: Record<string, unknown>): ReportFilters {
  const from = new Date(String(raw.from));
  const to = new Date(String(raw.to));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError('Invalid date range');
  }
  return {
    from,
    to,
    vendorId: (raw.vendorId as string | null) ?? null,
    categoryId: (raw.categoryId as string | null) ?? null,
    status: (raw.status as string | null) ?? null,
    bornBy: (raw.bornBy as string | null) ?? null,
  };
}

export async function resolveReportExportSource(
  actor: ExportActor,
  reportType: string,
  rawFilters: Record<string, unknown>,
): Promise<ExportSource> {
  const def = getReportDefinition(reportType);
  if (!def) throw new NotFoundError(ERROR_MESSAGES.REPORT_NOT_FOUND);
  if (!actorCanAccess(actor.permissions as any, actor.roleName, def.permissions)) {
    throw new ForbiddenError(ERROR_MESSAGES.REPORT_FORBIDDEN);
  }
  if (isVendorStaff(actor.permissions as any, actor.roleName) && def.financial) {
    throw new ForbiddenError(ERROR_MESSAGES.REPORT_FORBIDDEN);
  }

  const parsed = toReportFilters(rawFilters);
  assertReportRange(parsed);
  const filters = resolveFiltersForActor(actor as any, parsed, def.vendorScoped);
  if (def.audience === 'customer') filters.userId = actor.id;

  return {
    title: documentKeyToPdfTitle(def.type),
    columns: def.columns.map((col) => ({
      key: col.key,
      label: resolveReportColumnLabel(col.labelKey),
      format: col.format,
    })),
    estimateTotal: () => countReportRows(def, filters).catch(() => null),
    rows: () => createReportRowIterator(def, filters),
  };
}

/** Registered once at module load — see reports.routes.ts import below. */
registerExportDomain('report', resolveReportExportSource);
