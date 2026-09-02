import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import type { PermissionKey } from '@core/permissions/permissionKeys';
import { buildPaginationMeta } from '@core/http/pagination';
import { getReportDefinition, listReportDefinitionsForPermissions } from './reportRegistry';
import { assertReportRange } from './queryHelpers';
import type { ReportFilters } from './types';
import type { ReportExportFormat } from './csvExporter';
import { generateReportExport, type DirectExportResult } from './generateReportExport';
import {
  actorCanAccess,
  isVendorStaff,
  resolveFiltersForActor,
} from './reportEngine.helpers';
import type { ReportActor } from './reportEngine.types';

export type { ReportActor } from './reportEngine.types';
export type { DirectExportResult };
export { resolveFiltersForActor } from './reportEngine.helpers';

export class ReportEngine {
  catalog(actor: ReportActor) {
    const staff = isVendorStaff(actor.permissions, actor.roleName);
    return listReportDefinitionsForPermissions(actor.permissions, actor.roleName).filter((d) => {
      if (staff && d.financial) return false;
      return true;
    });
  }

  async runJson(actor: ReportActor, reportType: string, rawFilters: ReportFilters) {
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
    if (def.audience === 'customer') {
      filters.userId = actor.id;
    }
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const result = await def.query({ ...filters, page, limit });
    return {
      reportType: def.type,
      columns: def.columns,
      rows: result.rows,
      meta: result.meta ?? null,
      pagination: buildPaginationMeta(result.total, page, limit),
    };
  }

  /** Generate export file in-request — returns buffer for direct HTTP download. */
  runExportDirect(
    actor: ReportActor,
    reportType: string,
    rawFilters: ReportFilters,
    exportFormat: ReportExportFormat = 'xlsx',
  ): Promise<DirectExportResult> {
    return generateReportExport(actor, reportType, rawFilters, exportFormat);
  }
}

export const reportEngine = new ReportEngine();
