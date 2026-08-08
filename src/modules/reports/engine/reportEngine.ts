import fs from 'node:fs/promises';
import path from 'node:path';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PERMISSIONS, type PermissionKey } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { ReportExportLog } from '@database/models/reportExportLog.model';
import { buildPaginationMeta } from '@core/http/pagination';
import { areQueuesReady, queues, DEFAULT_TRANSACTIONAL_JOB_OPTIONS } from '@config/queue';
import { isS3Configured, uploadObject } from '@config/s3';
import { logger } from '@core/logger';
import { env } from '@config/env';
import { notificationsService } from '@modules/notifications/notifications.service';
import { getReportDefinition, listReportDefinitionsForPermissions } from './reportRegistry';
import { buildExcelBuffer, buildReportFilename } from './excelExporter';
import {
  REPORT_ASYNC_ROW_THRESHOLD,
  REPORT_EXPORT_PAGE_SIZE,
  type ReportFilters,
} from './types';
import { assertReportRange, normalizeReportFilters } from './queryHelpers';

export const REPORT_EXPORT_JOB = 'report-export';

const LOCAL_EXPORT_DIR = path.join(process.cwd(), 'storage', 'report-exports');

export type ReportActor = {
  id: string;
  vendorId?: string | null;
  roleName: string;
  permissions: PermissionKey[];
};

function actorCanAccess(
  permissions: PermissionKey[],
  roleName: string,
  required: PermissionKey[],
): boolean {
  if (roleName === ROLES.SUPER_ADMIN) return true;
  if (required.length === 0) return true;
  return required.some((p) => permissions.includes(p));
}

function isVendorStaff(permissions: PermissionKey[], roleName: string): boolean {
  if (roleName === ROLES.SUPER_ADMIN || roleName === ROLES.VENDOR_OWNER) return false;
  const hasOwnerFinance = permissions.includes(PERMISSIONS.PAYOUT_VIEW);
  const hasStaffOps =
    permissions.includes(PERMISSIONS.SUBORDER_MANAGE) ||
    permissions.includes(PERMISSIONS.PRODUCT_UPDATE);
  return !hasOwnerFinance && hasStaffOps;
}

function reportsHubPath(actor: ReportActor): string {
  if (actor.roleName === ROLES.VENDOR_OWNER || actor.roleName === ROLES.VENDOR_STAFF) {
    return '/vendor/dashboard/reports';
  }
  return '/admin/reports';
}

export function resolveFiltersForActor(
  actor: ReportActor,
  raw: ReportFilters,
  vendorScoped: boolean,
): ReportFilters {
  const filters = normalizeReportFilters({ ...raw });
  if (vendorScoped) {
    // Platform admins may run vendor-scoped report types across vendors (optional vendorId).
    if (actor.roleName === ROLES.SUPER_ADMIN) {
      filters.scopedVendorId = filters.vendorId ?? null;
      return filters;
    }
    if (!actor.vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
    }
    // Reject cross-vendor probing instead of silently rewriting.
    if (raw.vendorId && raw.vendorId !== actor.vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_VENDOR_REPORT);
    }
    filters.scopedVendorId = actor.vendorId;
    filters.vendorId = actor.vendorId;
  } else if (
    actor.roleName !== ROLES.SUPER_ADMIN &&
    !actor.permissions.includes(PERMISSIONS.COMMISSION_VIEW)
  ) {
    filters.vendorId = filters.vendorId ?? null;
  }
  return filters;
}

async function fetchAllRows(
  query: (filters: ReportFilters) => Promise<{ rows: Record<string, unknown>[]; total: number; meta?: Record<string, unknown> }>,
  filters: ReportFilters,
): Promise<{ rows: Record<string, unknown>[]; total: number; meta?: Record<string, unknown> }> {
  const first = await query({ ...filters, page: 1, limit: REPORT_EXPORT_PAGE_SIZE });
  if (first.total <= first.rows.length) return first;
  const rows = [...first.rows];
  const pages = Math.ceil(first.total / REPORT_EXPORT_PAGE_SIZE);
  for (let page = 2; page <= pages; page += 1) {
    const chunk = await query({ ...filters, page, limit: REPORT_EXPORT_PAGE_SIZE });
    rows.push(...chunk.rows);
  }
  return { rows, total: first.total, meta: first.meta };
}

async function persistExportFile(key: string, buffer: Buffer): Promise<{ fileKey: string; fileUrl: string | null }> {
  if (isS3Configured()) {
    const fileUrl = await uploadObject({
      key,
      body: buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return { fileKey: key, fileUrl };
  }
  await fs.mkdir(LOCAL_EXPORT_DIR, { recursive: true });
  const fileName = key.replace(/\//g, '_');
  const full = path.join(LOCAL_EXPORT_DIR, fileName);
  await fs.writeFile(full, buffer);
  return { fileKey: fileName, fileUrl: null };
}

export async function readLocalExport(fileKey: string): Promise<Buffer> {
  const full = path.join(LOCAL_EXPORT_DIR, fileKey);
  return fs.readFile(full);
}

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

  async runExport(
    actor: ReportActor,
    reportType: string,
    rawFilters: ReportFilters,
  ): Promise<
    | {
        async: true;
        exportId: string;
        status: 'PENDING';
        rowCount: number;
      }
    | {
        async: false;
        exportId: string;
        filename: string;
        buffer: Buffer;
        fileUrl: string | null;
      }
  > {
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

    const countProbe = await def.query({ ...filters, page: 1, limit: 1 });
    const filtersUsed = {
      from: filters.from.toISOString(),
      to: filters.to.toISOString(),
      vendorId: filters.vendorId ?? null,
      scopedVendorId: filters.scopedVendorId ?? filters.vendorId ?? null,
      categoryId: filters.categoryId ?? null,
      status: filters.status ?? null,
      reportsPath: reportsHubPath(actor),
    };

    if (countProbe.total > REPORT_ASYNC_ROW_THRESHOLD) {
      const log = await ReportExportLog.create({
        userId: actor.id,
        reportType: def.type,
        filtersUsed,
        format: 'xlsx',
        status: 'PENDING',
        rowCount: countProbe.total,
        fileKey: null,
        fileUrl: null,
        errorMessage: null,
        exportedAt: new Date(),
        createdBy: actor.id,
        updatedBy: actor.id,
        deletedBy: null,
      });
      if (areQueuesReady()) {
        await queues.reportExport.add(
          REPORT_EXPORT_JOB,
          { exportLogId: log.id },
          DEFAULT_TRANSACTIONAL_JOB_OPTIONS,
        );
      } else {
        // Process inline when Redis is down so exports still complete in dev.
        void this.processExportJob(log.id).catch((err) =>
          logger.error('Inline report export failed', {
            error: err instanceof Error ? err.message : err,
          }),
        );
      }
      return {
        async: true as const,
        exportId: log.id,
        status: 'PENDING' as const,
        rowCount: countProbe.total,
      };
    }

    const full = await fetchAllRows(def.query, filters);
    const buffer = await buildExcelBuffer(def.columns, full.rows, def.type);
    const filename = buildReportFilename(def.type, filters.from, filters.to);
    const stored = await persistExportFile(`reports/${actor.id}/${filename}`, buffer);
    const log = await ReportExportLog.create({
      userId: actor.id,
      reportType: def.type,
      filtersUsed,
      format: 'xlsx',
      status: 'SYNC',
      rowCount: full.total,
      fileKey: stored.fileKey,
      fileUrl: stored.fileUrl,
      errorMessage: null,
      exportedAt: new Date(),
      createdBy: actor.id,
      updatedBy: actor.id,
      deletedBy: null,
    });
    return {
      async: false as const,
      exportId: log.id,
      filename,
      buffer,
      fileUrl: stored.fileUrl,
    };
  }

  async processExportJob(exportLogId: string) {
    const log = await ReportExportLog.findByPk(exportLogId);
    if (!log || log.status === 'READY') return;
    const def = getReportDefinition(log.reportType);
    if (!def) {
      await log.update({ status: 'FAILED', errorMessage: ERROR_MESSAGES.REPORT_NOT_FOUND });
      return;
    }
    try {
      const f = log.filtersUsed as Record<string, unknown>;
      const filters: ReportFilters = normalizeReportFilters({
        from: new Date(String(f.from)),
        to: new Date(String(f.to)),
        vendorId: (f.vendorId as string) ?? null,
        categoryId: (f.categoryId as string) ?? null,
        status: (f.status as string) ?? null,
        scopedVendorId:
          (f.scopedVendorId as string) ??
          (def.vendorScoped ? ((f.vendorId as string) ?? null) : null),
        userId: log.userId,
      });
      const full = await fetchAllRows(def.query, filters);
      const buffer = await buildExcelBuffer(def.columns, full.rows, def.type);
      const filename = buildReportFilename(def.type, filters.from, filters.to);
      const stored = await persistExportFile(`reports/${log.userId}/${filename}`, buffer);
      await log.update({
        status: 'READY',
        rowCount: full.total,
        fileKey: stored.fileKey,
        fileUrl: stored.fileUrl,
        errorMessage: null,
        updatedBy: log.userId,
      });

      const clientBase = env.CLIENT_URL.replace(/\/$/, '');
      const reportsPath =
        typeof f.reportsPath === 'string' && f.reportsPath.startsWith('/')
          ? f.reportsPath
          : '/admin/reports';
      void notificationsService.sendReportExportReady(log.userId, log.id, {
        reportType: log.reportType,
        rowCount: full.total,
        actionUrl: `${clientBase}${reportsPath}?exportId=${log.id}`,
      });
    } catch (err) {
      await log.update({
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : 'Export failed',
      });
      throw err;
    }
  }

  async getExportStatus(
    actor: ReportActor,
    exportId: string,
  ): Promise<{
    id: string;
    reportType: string;
    status: string;
    rowCount: number;
    fileUrl: string | null;
    errorMessage: string | null;
    exportedAt: Date;
  }> {
    const log = await ReportExportLog.findByPk(exportId);
    if (!log) throw new NotFoundError('ReportExportLog');
    if (log.userId !== actor.id && actor.roleName !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError(ERROR_MESSAGES.REPORT_FORBIDDEN);
    }
    return {
      id: log.id,
      reportType: log.reportType,
      status: log.status,
      rowCount: log.rowCount,
      fileUrl: log.fileUrl,
      errorMessage: log.errorMessage,
      exportedAt: log.exportedAt,
    };
  }

  async getExportForDownload(actor: ReportActor, exportId: string) {
    const log = await ReportExportLog.findByPk(exportId);
    if (!log) throw new NotFoundError('ReportExportLog');
    if (log.userId !== actor.id && actor.roleName !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError(ERROR_MESSAGES.REPORT_FORBIDDEN);
    }
    if (log.status !== 'READY' && log.status !== 'SYNC') {
      throw new ValidationError(ERROR_MESSAGES.REPORT_EXPORT_NOT_READY);
    }
    if (log.fileUrl) {
      return { mode: 'redirect' as const, url: log.fileUrl, log };
    }
    if (!log.fileKey) {
      throw new ValidationError(ERROR_MESSAGES.REPORT_EXPORT_NOT_READY);
    }
    const buffer = await readLocalExport(log.fileKey);
    return { mode: 'buffer' as const, buffer, log };
  }
}

export const reportEngine = new ReportEngine();
