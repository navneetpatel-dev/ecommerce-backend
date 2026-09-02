import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Op, UniqueConstraintError } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { PERMISSIONS, type PermissionKey } from '@core/permissions/permissionKeys';
import { ROLES } from '@core/constants/statuses';
import { ReportExportLog } from '@database/models/reportExportLog.model';
import { buildPaginationMeta } from '@core/http/pagination';
import { areQueuesReady, queues, DEFAULT_TRANSACTIONAL_JOB_OPTIONS } from '@config/queue';
import {
  signedGetObjectUrl,
  uploadObjectStream,
  extractS3KeyFromUrl,
} from '@config/s3';
import { buildS3Key, S3_ENTITY_TYPES, S3_PURPOSES } from '@core/s3';
import { logger } from '@core/logger';
import { redisClient, withRedis } from '@config/redis';
import { env } from '@config/env';
import { notificationsService } from '@modules/notifications/notifications.service';
import { User } from '@database/models/user.model';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';
import { sanitizeExportErrorMessage } from './export/exportErrorMessage';
import { getReportDefinition, listReportDefinitionsForPermissions } from './reportRegistry';
import { buildReportFilename } from './excelExporter';
import {
  contentTypeForFormat,
  extensionForFormat,
  type ReportExportFormat,
} from './csvExporter';
import { assertReportRange, normalizeReportFilters } from './queryHelpers';
import type { ReportFilters } from './types';
import { buildExportKey } from './export/exportKey';
import { createReportRowIterator } from './export/ReportRowIterator';
import { createStreamingWriter } from './export/StreamingExportWriter';
import {
  exportArtifactExists,
  invalidateArtifactCache,
  markArtifactPresent,
} from './export/exportArtifactCache';
import { purgeExportRedisCaches } from './export/purgeExportRedisCaches';
import {
  completeExportIfProcessing,
  failExportIfProcessing,
  touchExportHeartbeat,
} from './export/exportJobLifecycle';
import { deleteExportArtifact } from './export/deleteExportArtifact';
import {
  isReportExportOnS3,
  readLocalReportExport,
  reportExportUsesS3,
  REPORT_EXPORT_LOCAL_DIR,
} from './export/reportExportStorage';
import {
  presignedCacheKey,
  statusCacheKey,
} from './export/exportCacheKeys';
import { reportExportConfig } from '../reportExportConfig';
import { emitReportExportMetric } from '../reportExportMetrics';

export const REPORT_EXPORT_JOB = 'report-export';

const LOCAL_EXPORT_DIR = REPORT_EXPORT_LOCAL_DIR;

export type ReportActor = {
  id: string;
  vendorId?: string | null;
  roleName: string;
  permissions: PermissionKey[];
};

export type RunExportOptions = {
  priority?: number;
  bornBy?: string | null;
  /** Generate the artifact in-request (skips queue). Used for small wallet statements. */
  processInline?: boolean;
};

export const REPORT_EXPORT_JOB_OPTIONS = {
  ...DEFAULT_TRANSACTIONAL_JOB_OPTIONS,
  attempts: 3,
} as const;

export type AsyncExportResult = {
  async: true;
  exportId: string;
  status: 'PENDING' | 'PROCESSING' | 'READY';
  format: ReportExportFormat;
  rowCount: number;
  /** False until worker finishes streaming (row count unknown at enqueue). */
  rowCountKnown: boolean;
  /** True when a READY artifact was reused within cache TTL. */
  cached?: boolean;
  /** True when an in-flight export with the same key was reused. */
  deduped?: boolean;
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
  if (actor.roleName === ROLES.CUSTOMER) return '/wallet';
  if (actor.roleName === ROLES.VENDOR_OWNER || actor.roleName === ROLES.VENDOR_STAFF) {
    return '/vendor/dashboard/reports';
  }
  return '/admin/reports';
}

function statusEtag(log: ReportExportLog): string {
  const base = `${log.id}:${log.status}:${log.updatedAt.toISOString()}:${log.rowCount}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 16);
}

export function resolveFiltersForActor(
  actor: ReportActor,
  raw: ReportFilters,
  vendorScoped: boolean,
): ReportFilters {
  const filters = normalizeReportFilters({ ...raw });
  if (vendorScoped) {
    if (actor.roleName === ROLES.SUPER_ADMIN) {
      filters.scopedVendorId = filters.vendorId ?? null;
      return filters;
    }
    if (!actor.vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
    }
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

async function cacheExportStatus(exportId: string, payload: Record<string, unknown>): Promise<void> {
  await withRedis(() =>
    redisClient.setex(
      statusCacheKey(exportId),
      reportExportConfig.statusCacheTtlSec,
      JSON.stringify(payload),
    ),
  );
}

async function readCachedExportStatus(exportId: string): Promise<Record<string, unknown> | null> {
  const raw = await withRedis(() => redisClient.get(statusCacheKey(exportId)));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

async function invalidateExportStatusCache(exportId: string): Promise<void> {
  await withRedis(() => redisClient.del(statusCacheKey(exportId), presignedCacheKey(exportId)));
}

async function readCachedPresignedUrl(exportId: string): Promise<string | null> {
  return withRedis(() => redisClient.get(presignedCacheKey(exportId)));
}

async function cachePresignedUrl(exportId: string, url: string, ttlSec: number): Promise<void> {
  const cacheTtl = Math.max(60, ttlSec - 60);
  await withRedis(() => redisClient.setex(presignedCacheKey(exportId), cacheTtl, url));
}

function buildFiltersUsed(
  filters: ReportFilters,
  actor: ReportActor,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    from: filters.from.toISOString(),
    to: filters.to.toISOString(),
    vendorId: filters.vendorId ?? null,
    scopedVendorId: filters.scopedVendorId ?? filters.vendorId ?? null,
    categoryId: filters.categoryId ?? null,
    status: filters.status ?? null,
    bornBy: filters.bornBy ?? null,
    reportsPath: reportsHubPath(actor),
    ...extra,
  };
}

async function findCachedExport(exportKey: string): Promise<ReportExportLog | null> {
  const cacheCutoff = new Date(Date.now() - reportExportConfig.cacheTtlMin * 60 * 1000);
  const cached = await ReportExportLog.findOne({
    where: {
      exportKey,
      status: 'READY',
      fileKey: { [Op.ne]: null },
      exportedAt: { [Op.gt]: cacheCutoff },
    },
    order: [['exportedAt', 'DESC']],
  });
  if (!cached) return null;
  if (await exportArtifactExists(cached, { forceProbe: true })) return cached;
  await cached.update({
    status: 'FAILED',
    errorMessage: 'Export artifact missing or expired',
    fileKey: null,
    fileUrl: null,
  });
  await purgeExportRedisCaches(cached.id);
  return null;
}

async function loadReportActor(userId: string): Promise<ReportActor | null> {
  const user = await User.findByPk(userId, {
    attributes: ['id', 'vendorId', 'roleId'],
    include: [{ association: 'role', attributes: ['name'] }],
  });
  if (!user) return null;
  const roleName = user.role?.name ?? roleNameOf(user as never);
  const permissions = await resolvePermissionsForUser({
    roleId: user.roleId,
    role: { name: roleName },
  });
  return {
    id: user.id,
    vendorId: user.vendorId ?? null,
    roleName,
    permissions,
  };
}

async function findInflightExport(exportKey: string): Promise<ReportExportLog | null> {
  return ReportExportLog.findOne({
    where: {
      exportKey,
      status: { [Op.in]: ['PENDING', 'PROCESSING'] },
    },
    order: [['createdAt', 'DESC']],
  });
}

async function failStaleInflightForKey(exportKey: string): Promise<void> {
  const pendingStaleCutoff = new Date(
    Date.now() - reportExportConfig.pendingStaleMin * 60 * 1000,
  );
  const processingStaleCutoff = new Date(
    Date.now() - reportExportConfig.staleProcessingMin * 60 * 1000,
  );
  await ReportExportLog.update(
    {
      status: 'FAILED',
      errorMessage: 'Export timed out',
    },
    {
      where: {
        exportKey,
        [Op.or]: [
          { status: 'PENDING', createdAt: { [Op.lt]: pendingStaleCutoff } },
          { status: 'PROCESSING', updatedAt: { [Op.lt]: processingStaleCutoff } },
        ],
      },
    },
  );
}

/** Matches FE export poll window so a retry can start a fresh job. */
function userExportStaleMs(): number {
  return reportExportConfig.isProduction ? 5 * 60 * 1000 : 90 * 1000;
}

async function failUserVisibleStaleExports(exportKey: string): Promise<void> {
  const cutoff = new Date(Date.now() - userExportStaleMs());
  const stale = await ReportExportLog.findAll({
    where: {
      exportKey,
      status: { [Op.in]: ['PENDING', 'PROCESSING'] },
      updatedAt: { [Op.lt]: cutoff },
    },
    attributes: ['id'],
  });
  if (stale.length === 0) return;
  for (const log of stale) {
    await purgeExportRedisCaches(log.id);
  }
  await ReportExportLog.update(
    { status: 'FAILED', errorMessage: 'Export timed out' },
    {
      where: {
        exportKey,
        status: { [Op.in]: ['PENDING', 'PROCESSING'] },
        updatedAt: { [Op.lt]: cutoff },
      },
    },
  );
}

function exportHeartbeatStaleMs(): number {
  return reportExportConfig.isProduction ? 60_000 : 15_000;
}

async function requeuePendingExportIfNeeded(
  log: ReportExportLog,
  processJob?: (exportLogId: string) => Promise<void>,
): Promise<void> {
  if (log.status !== 'PENDING') return;
  if (!areQueuesReady()) {
    if (reportExportConfig.inlineDev && !reportExportConfig.isProduction && processJob) {
      void processJob(log.id).catch((err) =>
        logger.error('Inline report export requeue failed', {
          exportLogId: log.id,
          error: err instanceof Error ? err.message : err,
        }),
      );
    }
    return;
  }
  try {
    const existing = await queues.reportExport.getJob(log.id);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') return;
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
      }
    }
    await queues.reportExport.add(
      REPORT_EXPORT_JOB,
      { exportLogId: log.id },
      {
        ...REPORT_EXPORT_JOB_OPTIONS,
        jobId: log.id,
        priority: reportExportConfig.userExportPriority,
      },
    );
  } catch (err) {
    logger.warn('Report export requeue skipped', {
      exportLogId: log.id,
      error: err instanceof Error ? err.message : String(err),
    });
    if (reportExportConfig.inlineDev && !reportExportConfig.isProduction && processJob) {
      void processJob(log.id).catch((inlineErr) =>
        logger.error('Inline report export fallback failed', {
          exportLogId: log.id,
          error: inlineErr instanceof Error ? inlineErr.message : inlineErr,
        }),
      );
    }
  }
}

async function invalidateStaleReadyExport(log: ReportExportLog): Promise<boolean> {
  if (log.status !== 'READY' && log.status !== 'SYNC') return true;
  if (!log.fileKey) {
    await log.update({
      status: 'FAILED',
      errorMessage: 'Export artifact missing or expired',
      fileKey: null,
      fileUrl: null,
    });
    await purgeExportRedisCaches(log.id);
    return false;
  }
  if (await exportArtifactExists(log, { forceProbe: true })) return true;
  await log.update({
    status: 'FAILED',
    errorMessage: 'Export artifact missing or expired',
    fileKey: null,
    fileUrl: null,
  });
  await purgeExportRedisCaches(log.id);
  return false;
}

async function findPendingExport(exportKey: string): Promise<ReportExportLog | null> {
  await failStaleInflightForKey(exportKey);
  await failUserVisibleStaleExports(exportKey);
  const pendingStaleCutoff = new Date(
    Date.now() - reportExportConfig.pendingStaleMin * 60 * 1000,
  );
  const processingStaleCutoff = new Date(
    Date.now() - reportExportConfig.staleProcessingMin * 60 * 1000,
  );
  return ReportExportLog.findOne({
    where: {
      exportKey,
      [Op.or]: [
        { status: 'PENDING', createdAt: { [Op.gt]: pendingStaleCutoff } },
        { status: 'PROCESSING', updatedAt: { [Op.gt]: processingStaleCutoff } },
      ],
    },
    order: [['createdAt', 'DESC']],
  });
}

async function persistExportStream(
  key: string,
  tempPath: string,
  format: ReportExportFormat,
  downloadFilename: string,
): Promise<{ fileKey: string; fileUrl: string | null; byteSize: number }> {
  const stat = await fsp.stat(tempPath);
  const safeName = downloadFilename.replace(/["\r\n]/g, '_');
  if (reportExportUsesS3()) {
    const stream = fs.createReadStream(tempPath);
    const fileUrl = await uploadObjectStream({
      key,
      stream,
      contentType: contentTypeForFormat(format),
      privateObject: true,
      contentDisposition: `attachment; filename="${safeName}"`,
    });
    return { fileKey: key, fileUrl, byteSize: stat.size };
  }
  await fsp.mkdir(LOCAL_EXPORT_DIR, { recursive: true });
  const fileName = key.replace(/\//g, '_');
  const full = path.join(LOCAL_EXPORT_DIR, fileName);
  await fsp.copyFile(tempPath, full);
  return { fileKey: fileName, fileUrl: null, byteSize: stat.size };
}

export async function readLocalExport(fileKey: string): Promise<Buffer> {
  return readLocalReportExport(fileKey);
}

export type AdminExportListRow = {
  id: string;
  userId: string;
  reportType: string;
  format: string | null;
  status: string;
  rowCount: number;
  rowCountKnown: boolean;
  byteSize: number | null;
  errorMessage: string | null;
  exportedAt: Date;
  filtersUsed: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

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

  /** All file exports (xlsx/csv/pdf) are always async — returns in ~200ms. */
  async runExport(
    actor: ReportActor,
    reportType: string,
    rawFilters: ReportFilters,
    exportFormat: ReportExportFormat = 'xlsx',
    options: RunExportOptions = {},
  ): Promise<AsyncExportResult> {
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
    if (options.bornBy) filters.bornBy = options.bornBy;

    const rowCount = 0;
    const filtersUsed = buildFiltersUsed(filters, actor);
    const exportKey = buildExportKey({
      userId: actor.id,
      reportType: def.type,
      filtersUsed,
      format: exportFormat,
    });

    const cached = await findCachedExport(exportKey);
    if (cached) {
      emitReportExportMetric({
        outcome: 'cache_hit',
        reportType: def.type,
        format: exportFormat,
        rowCount: cached.rowCount,
      });
      return {
        async: true,
        exportId: cached.id,
        status: 'READY',
        format: (cached.format as ReportExportFormat) || exportFormat,
        rowCount: cached.rowCount,
        rowCountKnown: true,
        cached: true,
      };
    }

    const pending = await findPendingExport(exportKey);
    if (pending) {
      if (options.processInline) {
        if (pending.status === 'READY') {
          return {
            async: true,
            exportId: pending.id,
            status: 'READY',
            format: (pending.format as ReportExportFormat) || exportFormat,
            rowCount: pending.rowCount,
            rowCountKnown: true,
            deduped: true,
          };
        }
        return this.finishInlineExport(pending.id, exportFormat, { deduped: true });
      }
      await requeuePendingExportIfNeeded(pending, this.processExportJob.bind(this));
      const reportStatus =
        pending.status === 'READY' || pending.status === 'PROCESSING'
          ? pending.status
          : 'PENDING';
      return {
        async: true,
        exportId: pending.id,
        status: reportStatus,
        format: (pending.format as ReportExportFormat) || exportFormat,
        rowCount: pending.rowCount,
        rowCountKnown: pending.rowCount > 0,
        deduped: true,
      };
    }

    const inflightOther = await ReportExportLog.count({
      where: {
        userId: actor.id,
        status: { [Op.in]: ['PENDING', 'PROCESSING'] },
        [Op.or]: [{ exportKey: { [Op.ne]: exportKey } }, { exportKey: null }],
      },
    });
    if (inflightOther >= reportExportConfig.maxPendingPerUser) {
      throw new AppError(
        ERROR_MESSAGES.REPORT_EXPORT_TOO_MANY_PENDING,
        429,
        ERROR_CODES.RATE_LIMITED,
        { retryAfterSec: 30 },
      );
    }

    const artifactExpiresAt = new Date(
      Date.now() + reportExportConfig.artifactTtlDays * 24 * 60 * 60 * 1000,
    );
    await failStaleInflightForKey(exportKey);
    let log: ReportExportLog;
    try {
      log = await ReportExportLog.create({
        userId: actor.id,
        reportType: def.type,
        filtersUsed,
        format: exportFormat,
        status: 'PENDING',
        rowCount,
        exportKey,
        expiresAt: artifactExpiresAt,
        fileKey: null,
        fileUrl: null,
        errorMessage: null,
        byteSize: null,
        exportedAt: new Date(),
        createdBy: actor.id,
        updatedBy: actor.id,
        deletedBy: null,
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        await failStaleInflightForKey(exportKey);
        const existing = await findInflightExport(exportKey);
        if (existing) {
          return {
            async: true,
            exportId: existing.id,
            status: 'PENDING',
            format: (existing.format as ReportExportFormat) || exportFormat,
            rowCount: existing.rowCount,
            rowCountKnown: existing.rowCount > 0,
            deduped: true,
          };
        }
      }
      throw err;
    }

    if (options.processInline) {
      return this.finishInlineExport(log.id, exportFormat);
    }

    const priority = options.priority ?? reportExportConfig.userExportPriority;

    if (areQueuesReady()) {
      try {
        await queues.reportExport.add(
          REPORT_EXPORT_JOB,
          { exportLogId: log.id },
          { ...REPORT_EXPORT_JOB_OPTIONS, jobId: log.id, priority },
        );
      } catch (err) {
        await log.destroy({ force: true });
        throw err;
      }
    } else if (reportExportConfig.inlineDev && !reportExportConfig.isProduction) {
      void this.processExportJob(log.id).catch((err) =>
        logger.error('Inline report export failed', {
          error: err instanceof Error ? err.message : err,
        }),
      );
    } else {
      await log.destroy({ force: true });
      throw new AppError(
        ERROR_MESSAGES.REPORT_EXPORT_QUEUE_UNAVAILABLE,
        503,
        ERROR_CODES.REPORT_EXPORT_QUEUE_UNAVAILABLE,
      );
    }

    emitReportExportMetric({
      outcome: 'enqueued',
      reportType: def.type,
      format: exportFormat,
      rowCount,
    });

    return {
      async: true,
      exportId: log.id,
      status: 'PENDING',
      format: exportFormat,
      rowCount,
      rowCountKnown: false,
    };
  }

  private async finishInlineExport(
    exportLogId: string,
    formatHint: ReportExportFormat,
    extra?: { deduped?: boolean },
  ): Promise<AsyncExportResult> {
    await this.processExportJob(exportLogId);
    const log = await ReportExportLog.findByPk(exportLogId);
    if (!log) {
      throw new AppError(
        ERROR_MESSAGES.REPORT_EXPORT_NOT_READY,
        500,
        ERROR_CODES.REPORT_EXPORT_NOT_READY,
      );
    }
    if (log.status === 'READY') {
      return {
        async: true,
        exportId: log.id,
        status: 'READY',
        format: (log.format as ReportExportFormat) || formatHint,
        rowCount: log.rowCount,
        rowCountKnown: true,
        ...(extra?.deduped ? { deduped: true } : {}),
      };
    }
    if (log.status === 'FAILED') {
      const message =
        log.errorMessage?.trim() ||
        sanitizeExportErrorMessage(new Error(ERROR_MESSAGES.REPORT_EXPORT_NOT_READY));
      logger.error('Inline report export failed', {
        exportLogId,
        reportType: log.reportType,
        format: log.format,
        errorMessage: log.errorMessage,
      });
      throw new AppError(message, 500, ERROR_CODES.REPORT_EXPORT_NOT_READY);
    }
    if (log.status === 'PENDING' || log.status === 'PROCESSING') {
      return {
        async: true,
        exportId: log.id,
        status: log.status,
        format: (log.format as ReportExportFormat) || formatHint,
        rowCount: log.rowCount,
        rowCountKnown: log.rowCount > 0,
        ...(extra?.deduped ? { deduped: true } : {}),
      };
    }
    throw new AppError(
      ERROR_MESSAGES.REPORT_EXPORT_NOT_READY,
      500,
      ERROR_CODES.REPORT_EXPORT_NOT_READY,
    );
  }

  /** Re-queue exports whose BullMQ job finished but DB row is still PENDING/PROCESSING. */
  private async ensureExportJobQueued(log: ReportExportLog): Promise<void> {
    if (log.status !== 'PENDING' && log.status !== 'PROCESSING') return;

    const heartbeatCutoff = new Date(Date.now() - exportHeartbeatStaleMs());
    const needsRecovery =
      log.status === 'PENDING' ||
      (log.status === 'PROCESSING' && log.updatedAt < heartbeatCutoff);
    if (!needsRecovery) return;

    let jobState: string | null = null;
    if (areQueuesReady()) {
      try {
        const job = await queues.reportExport.getJob(log.id);
        if (job) jobState = await job.getState();
      } catch (err) {
        logger.warn('Export job queue lookup failed', {
          exportLogId: log.id,
          error: err instanceof Error ? err.message : err,
        });
      }
      if (jobState === 'active' || jobState === 'waiting' || jobState === 'delayed') {
        return;
      }
    }

    if (log.status === 'PROCESSING') {
      const [reset] = await ReportExportLog.update(
        { status: 'PENDING', errorMessage: null },
        { where: { id: log.id, status: 'PROCESSING' } },
      );
      if (reset === 0) return;
      await purgeExportRedisCaches(log.id);
      logger.warn('Recovered orphaned report export', {
        exportLogId: log.id,
        priorJobState: jobState,
      });
    }

    if (areQueuesReady() && (jobState === 'completed' || jobState === 'failed')) {
      try {
        const job = await queues.reportExport.getJob(log.id);
        if (job) await job.remove();
      } catch {
        /* ignore */
      }
    }

    const fresh = await ReportExportLog.findByPk(log.id);
    if (!fresh || fresh.status !== 'PENDING') return;
    await requeuePendingExportIfNeeded(fresh, this.processExportJob.bind(this));
  }

  async processExportJob(exportLogId: string) {
    const log = await ReportExportLog.findByPk(exportLogId);
    if (!log || log.status === 'READY') return;

    const staleCutoff = new Date(
      Date.now() - reportExportConfig.staleProcessingMin * 60 * 1000,
    );
    const [claimed] = await ReportExportLog.update(
      { status: 'PROCESSING', updatedBy: log.userId },
      {
        where: {
          id: exportLogId,
          [Op.or]: [
            { status: 'PENDING' },
            { status: 'PROCESSING', updatedAt: { [Op.lt]: staleCutoff } },
          ],
        },
      },
    );
    if (claimed === 0) {
      const current = await ReportExportLog.findByPk(exportLogId);
      if (
        current?.status === 'PROCESSING' &&
        current.updatedAt < new Date(Date.now() - userExportStaleMs())
      ) {
        await failExportIfProcessing(exportLogId, 'Export timed out');
      }
      return;
    }

    const def = getReportDefinition(log.reportType);
    if (!def) {
      await failExportIfProcessing(
        exportLogId,
        sanitizeExportErrorMessage(new Error(ERROR_MESSAGES.REPORT_NOT_FOUND)),
      );
      return;
    }

    const actor = await loadReportActor(log.userId);
    if (!actor) {
      await failExportIfProcessing(exportLogId, 'Export user no longer exists');
      return;
    }
    if (!actorCanAccess(actor.permissions, actor.roleName, def.permissions)) {
      await failExportIfProcessing(
        exportLogId,
        sanitizeExportErrorMessage(new Error(ERROR_MESSAGES.REPORT_FORBIDDEN)),
      );
      return;
    }
    if (isVendorStaff(actor.permissions, actor.roleName) && def.financial) {
      await failExportIfProcessing(
        exportLogId,
        sanitizeExportErrorMessage(new Error(ERROR_MESSAGES.REPORT_FORBIDDEN)),
      );
      return;
    }

    const startedAt = Date.now();
    let writer: ReturnType<typeof createStreamingWriter> | null = null;

    try {
      const f = log.filtersUsed as Record<string, unknown>;
      const rawFilters = normalizeReportFilters({
        from: new Date(String(f.from)),
        to: new Date(String(f.to)),
        vendorId: (f.vendorId as string) ?? null,
        categoryId: (f.categoryId as string) ?? null,
        status: (f.status as string) ?? null,
        bornBy: (f.bornBy as string) ?? null,
        scopedVendorId:
          (f.scopedVendorId as string) ??
          (def.vendorScoped ? ((f.vendorId as string) ?? null) : null),
      });
      let filters: ReportFilters;
      try {
        filters = resolveFiltersForActor(actor, rawFilters, def.vendorScoped);
        if (def.audience === 'customer') filters.userId = log.userId;
      } catch (scopeErr) {
        await failExportIfProcessing(
          exportLogId,
          sanitizeExportErrorMessage(scopeErr),
        );
        return;
      }

      const exportFormat = (log.format as ReportExportFormat) || 'xlsx';
      writer = createStreamingWriter(exportFormat, def.columns, def.type);
      await writer.writeHeader();
      await touchExportHeartbeat(exportLogId);

      const knownTotal = log.rowCount > 0 ? log.rowCount : undefined;
      let actualRowCount = 0;
      const maxRows = reportExportConfig.maxRows;
      for await (const chunk of createReportRowIterator(def, filters, knownTotal)) {
        if (maxRows > 0 && actualRowCount + chunk.length > maxRows) {
          throw new ValidationError(
            `Export exceeds maximum row limit (${maxRows.toLocaleString()}) — narrow the date range`,
          );
        }
        actualRowCount += chunk.length;
        await writer.writeRows(chunk);
        await touchExportHeartbeat(exportLogId);
      }

      const artifact = await writer.finalize();
      const ext = extensionForFormat(exportFormat);
      const filename = buildReportFilename(def.type, filters.from, filters.to, ext);
      const key = buildS3Key(S3_ENTITY_TYPES.REPORTS, log.userId, S3_PURPOSES.EXPORT, filename);
      const stored = await persistExportStream(key, artifact.tempPath, exportFormat, filename);

      const artifactExpiresAt = new Date(
        Date.now() + reportExportConfig.artifactTtlDays * 24 * 60 * 60 * 1000,
      );

      const finalized = await completeExportIfProcessing(exportLogId, {
        status: 'READY',
        rowCount: actualRowCount,
        fileKey: stored.fileKey,
        fileUrl: stored.fileUrl,
        byteSize: stored.byteSize,
        expiresAt: artifactExpiresAt,
        errorMessage: null,
        updatedBy: log.userId,
        exportedAt: new Date(),
      });
      if (!finalized) {
        await deleteExportArtifact({ fileKey: stored.fileKey, fileUrl: stored.fileUrl });
        await failExportIfProcessing(
          exportLogId,
          sanitizeExportErrorMessage(new Error('Export could not be finalized')),
        );
        await invalidateExportStatusCache(log.id);
        return;
      }

      await invalidateExportStatusCache(log.id);
      await invalidateArtifactCache(log.id);
      await markArtifactPresent(log.id);

      emitReportExportMetric({
        outcome: 'completed',
        reportType: log.reportType,
        format: exportFormat,
        rowCount: actualRowCount,
        durationMs: Date.now() - startedAt,
        byteSize: Number(stored.byteSize),
      });

      const clientBase = env.CLIENT_URL.replace(/\/$/, '');
      const reportsPath =
        typeof f.reportsPath === 'string' && f.reportsPath.startsWith('/')
          ? f.reportsPath
          : reportsHubPath(actor);
      void notificationsService.sendReportExportReady(log.userId, log.id, {
        reportType: log.reportType,
        rowCount: actualRowCount,
        actionUrl: `${clientBase}${reportsPath}?exportId=${log.id}&format=${exportFormat}`,
      });
    } catch (err) {
      emitReportExportMetric({
        outcome: 'failed',
        reportType: log.reportType,
        format: (log.format as ReportExportFormat) || 'xlsx',
        durationMs: Date.now() - startedAt,
      });
      await failExportIfProcessing(exportLogId, sanitizeExportErrorMessage(err));
      await invalidateExportStatusCache(log.id);
      return;
    } finally {
      if (writer) await writer.dispose().catch(() => undefined);
    }
  }

  async getExportStatus(
    actor: ReportActor,
    exportId: string,
    ifNoneMatch?: string | null,
  ): Promise<
    | { notModified: true; etag: string }
    | {
        id: string;
        reportType: string;
        format: string;
        status: string;
        rowCount: number;
        rowCountKnown: boolean;
        fileUrl: string | null;
        downloadUrl: string | null;
        expiresIn: number | null;
        errorMessage: string | null;
        exportedAt: Date;
        filterFrom: string | null;
        filterTo: string | null;
        etag: string;
      }
  > {
    let log = await ReportExportLog.findByPk(exportId);
    if (!log) throw new NotFoundError('ReportExportLog');
    if (log.userId !== actor.id && actor.roleName !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError(ERROR_MESSAGES.REPORT_FORBIDDEN);
    }

    if (log.status === 'PENDING' || log.status === 'PROCESSING') {
      void this.ensureExportJobQueued(log).catch((err) =>
        logger.warn('Export recovery skipped', {
          exportLogId: log.id,
          error: err instanceof Error ? err.message : err,
        }),
      );
    }

    const etag = statusEtag(log);
    if (
      ifNoneMatch &&
      ifNoneMatch === etag &&
      (log.status === 'PENDING' || log.status === 'PROCESSING')
    ) {
      return { notModified: true, etag };
    }

    const cached = await readCachedExportStatus(exportId);
    if (
      cached &&
      (cached.status === 'PENDING' || cached.status === 'PROCESSING') &&
      (log.status === 'PENDING' || log.status === 'PROCESSING')
    ) {
      const cachedEtag = typeof cached.etag === 'string' ? cached.etag : etag;
      if (ifNoneMatch && ifNoneMatch === cachedEtag) {
        return { notModified: true, etag: cachedEtag };
      }
      return cached as Awaited<ReturnType<ReportEngine['getExportStatus']>>;
    }

    const filtersUsed = log.filtersUsed as Record<string, unknown>;
    const currentEtag = statusEtag(log);
    const payload = {
      id: log.id,
      reportType: log.reportType,
      format: log.format || 'xlsx',
      status: log.status,
      rowCount: log.rowCount,
      rowCountKnown: log.status === 'READY' || log.status === 'SYNC' || log.rowCount > 0,
      fileUrl: reportExportUsesS3() ? null : log.fileUrl,
      downloadUrl: null,
      expiresIn: null,
      errorMessage: log.errorMessage
        ? sanitizeExportErrorMessage(new Error(log.errorMessage))
        : null,
      exportedAt: log.exportedAt,
      filterFrom: typeof filtersUsed.from === 'string' ? filtersUsed.from : null,
      filterTo: typeof filtersUsed.to === 'string' ? filtersUsed.to : null,
      etag: currentEtag,
    };

    if (log.status === 'PENDING' || log.status === 'PROCESSING') {
      void cacheExportStatus(exportId, payload);
    }

    return payload;
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
    if (!(await invalidateStaleReadyExport(log))) {
      throw new ValidationError(ERROR_MESSAGES.REPORT_EXPORT_NOT_READY);
    }
    await log.reload();

    if (isReportExportOnS3(log) && log.fileKey) {
      const s3Key = log.fileUrl ? extractS3KeyFromUrl(log.fileUrl) ?? log.fileKey : log.fileKey;
      let url = await readCachedPresignedUrl(exportId);
      if (!url) {
        url = await signedGetObjectUrl(s3Key!, reportExportConfig.presignedExpiresSec);
        if (url) {
          await cachePresignedUrl(exportId, url, reportExportConfig.presignedExpiresSec);
        }
      }
      return {
        mode: 'presigned' as const,
        url,
        expiresIn: reportExportConfig.presignedExpiresSec,
        log,
      };
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

  async retryExport(
    actor: ReportActor,
    exportId: string,
    options?: { asOriginalUser?: boolean },
  ): Promise<AsyncExportResult> {
    const log = await ReportExportLog.findByPk(exportId);
    if (!log) throw new NotFoundError('ReportExportLog');
    if (log.status !== 'FAILED') {
      throw new ValidationError(ERROR_MESSAGES.REPORT_EXPORT_RETRY_FAILED_ONLY);
    }
    if (log.userId !== actor.id && actor.roleName !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError(ERROR_MESSAGES.REPORT_FORBIDDEN);
    }
    const f = log.filtersUsed as Record<string, unknown>;
    const exportActor: ReportActor =
      options?.asOriginalUser && actor.roleName === ROLES.SUPER_ADMIN
        ? ((await loadReportActor(log.userId)) ?? actor)
        : actor;
    return this.runExport(
      exportActor,
      log.reportType,
      {
        from: new Date(String(f.from)),
        to: new Date(String(f.to)),
        vendorId: (f.vendorId as string) ?? null,
        categoryId: (f.categoryId as string) ?? null,
        status: (f.status as string) ?? null,
        bornBy: (f.bornBy as string) ?? null,
        scopedVendorId: (f.scopedVendorId as string) ?? null,
      },
      (log.format as ReportExportFormat) || 'xlsx',
    );
  }

  async listRecentExports(
    limit = 50,
    filters?: { status?: string; reportType?: string; offset?: number },
  ): Promise<AdminExportListRow[]> {
    const where: Record<string, unknown> = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.reportType) where.reportType = filters.reportType;
    const offset = Math.max(0, filters?.offset ?? 0);

    const rows = await ReportExportLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Math.min(Math.max(1, limit), 500),
      offset,
      attributes: [
        'id',
        'userId',
        'reportType',
        'format',
        'status',
        'rowCount',
        'byteSize',
        'errorMessage',
        'exportedAt',
        'filtersUsed',
        'createdAt',
        'updatedAt',
      ],
    });

    return rows.map((log) => ({
      id: log.id,
      userId: log.userId,
      reportType: log.reportType,
      format: log.format,
      status: log.status,
      rowCount: log.rowCount,
      rowCountKnown:
        log.status === 'READY' || log.status === 'SYNC' || log.rowCount > 0,
      byteSize: log.byteSize,
      errorMessage: log.errorMessage
        ? sanitizeExportErrorMessage(new Error(log.errorMessage))
        : null,
      exportedAt: log.exportedAt,
      filtersUsed: log.filtersUsed as Record<string, unknown> | null,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
    }));
  }
}

export const reportEngine = new ReportEngine();
