import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import {
  BUG_AFFECTED_MODULE,
  BUG_REPORTER_ROLE,
  BUG_REPORT_STATUS,
  DOCUMENT_SEQUENCE_KIND,
  ROLES,
  type BugReportStatus,
  type BugReporterRole,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { env } from '@config/env';
import { BugReport } from '@database/models/bugReport.model';
import { BugReportAttachment } from '@database/models/bugReportAttachment.model';
import { BugReportComment } from '@database/models/bugReportComment.model';
import { User } from '@database/models/user.model';
import { sequelize } from '@database/models';
import {
  buildKeysetPage,
  buildKeysetWhere,
  decodeCursor,
  keysetOrder,
  type KeysetQuery,
} from '@core/http/keysetPagination';
import { parseUserAgent } from '@core/http/parseUserAgent';
import { nextPaddedDocumentNumber } from '@modules/pricing/documentSequence';
import { notificationsService } from '@modules/notifications/notifications.service';
import { bugReportPortalUrl } from '@modules/notifications/portalLinks';
import { findSuperAdminUserIds } from '@modules/notifications/orderNotifications';
import { settingsService } from '@modules/settings/settings.service';
import { logAudit } from '@modules/audit/audit.service';
import { usersService } from '@modules/users/users.service';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { extractS3KeyFromUrl, signedGetObjectUrlMap } from '@config/s3';
import { rebaseAttachmentUrlsToEntity, S3_ENTITY_TYPES } from '@core/s3';
import {
  assertAttachmentLimits,
} from '@core/media';
import { assertRemoteVideoBackstop } from '@core/media';
import { AuditLog } from '@database/models/auditLog.model';
import type {
  AdminBugListQuery,
  BugCommentRequest,
  BugStatusRequest,
  CreateBugReportRequest,
  DuplicateBugReportRequest,
  MineBugListQuery,
  TriageBugReportRequest,
  UpdateBugAssignmentRequest,
  WontFixBugReportRequest,
} from './bugReports.dto';
import { BUG_ALLOWED_TRANSITIONS } from './bugReports.lifecycle';

/** Statuses where triage fields (severity/module/assignee) may be updated without a status change. */
const ASSIGNMENT_EDITABLE_STATUSES: BugReportStatus[] = [
  BUG_REPORT_STATUS.TRIAGED,
  BUG_REPORT_STATUS.IN_PROGRESS,
  BUG_REPORT_STATUS.FIXED,
];

/** Public timeline actions visible to reporters (excludes internal comments). */
const PUBLIC_BUG_TIMELINE_ACTIONS = new Set([
  'BUG_REPORT_CREATED',
  'BUG_REPORT_TRIAGED',
  'BUG_REPORT_STATUS',
  'BUG_REPORT_DUPLICATE',
  'BUG_REPORT_WONT_FIX',
  'BUG_REPORT_VERIFIED',
  'BUG_REPORT_AUTO_VERIFIED',
  'BUG_REPORT_AUTO_CLOSED',
]);

const ADMIN_BUG_TIMELINE_ACTIONS = new Set([
  ...PUBLIC_BUG_TIMELINE_ACTIONS,
  'BUG_REPORT_ASSIGNMENT_UPDATED',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Actor = {
  id: string;
  vendorId: string | null;
  roleId: string;
  role: { name: string };
};

const FORBIDDEN_REPORTER_KEYS = [
  'severity',
  'assignedToId',
  'affectedModule',
  'status',
  'duplicateOfId',
  'triagedAt',
  'resolvedAt',
  'verifiedAt',
  'inProgressAt',
] as const;

function assertTransition(from: BugReportStatus, to: BugReportStatus) {
  const allowed = BUG_ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      ERROR_MESSAGES.BUG_INVALID_TRANSITION,
      422,
      ERROR_CODES.BUG_INVALID_TRANSITION,
    );
  }
}

function toReporterRole(roleName: string): BugReporterRole {
  if (roleName === ROLES.CUSTOMER) return BUG_REPORTER_ROLE.CUSTOMER;
  if (roleName === ROLES.VENDOR_OWNER) return BUG_REPORTER_ROLE.VENDOR;
  if (roleName === ROLES.VENDOR_STAFF) return BUG_REPORTER_ROLE.VENDOR_STAFF;
  throw new AppError(
    ERROR_MESSAGES.BUG_REPORTER_ROLE_INVALID,
    403,
    ERROR_CODES.BUG_REPORTER_ROLE_INVALID,
  );
}

function assertNoReporterTriageFields(body: Record<string, unknown>) {
  for (const key of FORBIDDEN_REPORTER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined) {
      throw new AppError(
        ERROR_MESSAGES.BUG_REPORTER_FIELDS_FORBIDDEN,
        422,
        ERROR_CODES.BUG_REPORTER_FIELDS_FORBIDDEN,
      );
    }
  }
}

async function assertBugManagePermission(actor: Actor): Promise<void> {
  const permissions = await resolvePermissionsForUser(actor);
  if (!permissions.includes(PERMISSIONS.BUG_REPORT_MANAGE)) {
    throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
  }
}

async function serializeAttachments(rows: BugReportAttachment[]) {
  const plains = rows.map((row) =>
    typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row,
  );
  const keyByIndex = plains.map((plain) => extractS3KeyFromUrl(plain.url));
  const signedByKey = await signedGetObjectUrlMap(keyByIndex);
  return plains.map((plain, index) => {
    const key = keyByIndex[index];
    return {
      id: plain.id,
      bugReportId: plain.bugReportId,
      url: (key && signedByKey.get(key)) || plain.url,
      type: plain.type,
      durationSeconds: plain.durationSeconds ?? null,
      createdAt: plain.createdAt,
    };
  });
}

function serializeComment(row: BugReportComment & { author?: User }) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    bugReportId: plain.bugReportId,
    authorId: plain.authorId,
    authorName: plain.author?.name ?? null,
    body: plain.body,
    createdAt: plain.createdAt,
  };
}

type SerializedAttachment = Awaited<ReturnType<typeof serializeAttachments>>[number];

type TimelineEntry = {
  action: string;
  createdAt: string | Date;
  status: string | null;
  from: string | null;
  to: string | null;
  automated: boolean;
  duplicateOfReportNumber: string | null;
};

async function loadBugTimeline(
  bugReportId: string,
  includeInternal: boolean,
  transaction?: Transaction,
): Promise<TimelineEntry[]> {
  const allowed = includeInternal ? ADMIN_BUG_TIMELINE_ACTIONS : PUBLIC_BUG_TIMELINE_ACTIONS;
  const rows = await AuditLog.findAll({
    where: {
      entityType: 'BugReport',
      entityId: bugReportId,
      action: { [Op.in]: [...allowed] },
    },
    order: [['createdAt', 'ASC']],
    limit: 100,
    attributes: ['action', 'metadata', 'createdAt'],
    transaction,
  });

  return rows.map((row) => {
    const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
    const metadata = (plain.metadata ?? {}) as Record<string, unknown>;
    return {
      action: plain.action,
      createdAt: plain.createdAt,
      status: typeof metadata.status === 'string' ? metadata.status : null,
      from: typeof metadata.from === 'string' ? metadata.from : null,
      to: typeof metadata.to === 'string' ? metadata.to : null,
      automated: metadata.automated === true,
      duplicateOfReportNumber:
        typeof metadata.duplicateOfReportNumber === 'string'
          ? metadata.duplicateOfReportNumber
          : null,
    };
  });
}

function normalizeDuplicateRef(raw: string): { id?: string; reportNumber?: string } {
  const value = raw.trim();
  if (UUID_RE.test(value)) return { id: value };
  const upper = value.toUpperCase();
  if (/^BUG-\d+$/.test(upper)) return { reportNumber: upper };
  if (/^\d+$/.test(upper)) return { reportNumber: `BUG-${upper.padStart(6, '0')}` };
  return { reportNumber: upper };
}

function serializeBugReport(
  row: BugReport,
  extras: {
    attachments?: SerializedAttachment[];
    comments?: ReturnType<typeof serializeComment>[];
    timeline?: TimelineEntry[];
    includeInternal?: boolean;
  } = {},
) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  const base = {
    id: plain.id,
    reportNumber: plain.reportNumber,
    reporterId: plain.reporterId,
    reporterName: plain.reporter?.name ?? null,
    reporterRole: plain.reporterRole,
    title: plain.title,
    description: plain.description,
    stepsToReproduce: plain.stepsToReproduce ?? null,
    severity: plain.severity,
    status: plain.status,
    duplicateOfId: plain.duplicateOfId ?? plain.duplicateOf?.id ?? null,
    duplicateOfReportNumber: plain.duplicateOf?.reportNumber ?? null,
    assignedToId: plain.assignedToId ?? null,
    assignedToName: plain.assignedTo?.name ?? null,
    affectedModule: plain.affectedModule,
    pageUrl: plain.pageUrl ?? null,
    userAgent: plain.userAgent ?? null,
    browserName: plain.browserName ?? null,
    osName: plain.osName ?? null,
    deviceType: plain.deviceType ?? null,
    appVersion: plain.appVersion ?? null,
    userId: plain.userId,
    userRole: plain.userRole,
    occurredAt: plain.occurredAt,
    triagedAt: plain.triagedAt ?? null,
    inProgressAt: plain.inProgressAt ?? null,
    resolvedAt: plain.resolvedAt ?? null,
    verifiedAt: plain.verifiedAt ?? null,
    wontFixReason: plain.wontFixReason ?? null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    attachments: extras.attachments,
    timeline: extras.timeline ?? [],
  };

  if (extras.includeInternal) {
    return { ...base, comments: extras.comments ?? [] };
  }
  return base;
}

function assertBugAccess(bug: BugReport, actor: Actor, hasManagePermission: boolean): void {
  if (hasManagePermission) return;
  if (bug.reporterId === actor.id) return;
  throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
}

export class BugReportsService {
  async create(
    actor: Actor,
    data: CreateBugReportRequest,
    rawBody: Record<string, unknown>,
    userAgentHeader: string | undefined,
    pageUrlFromRequest: string | null,
  ) {
    assertNoReporterTriageFields(rawBody);
    const reporterRole = toReporterRole(actor.role.name);
    assertAttachmentLimits(data.attachmentUrls ?? [], 'bug');
    await assertRemoteVideoBackstop(data.attachmentUrls ?? [], 'bug');

    const ua = parseUserAgent(userAgentHeader);

    return sequelize.transaction(async (t) => {
      const reportNumber = await nextPaddedDocumentNumber(
        DOCUMENT_SEQUENCE_KIND.BUG_REPORT,
        t,
      );

      const bug = await BugReport.create(
        {
          reportNumber,
          reporterId: actor.id,
          reporterRole,
          title: data.title,
          description: data.description,
          stepsToReproduce: data.stepsToReproduce ?? null,
          severity: null,
          status: BUG_REPORT_STATUS.NEW,
          duplicateOfId: null,
          assignedToId: null,
          affectedModule: BUG_AFFECTED_MODULE.OTHER,
          pageUrl: pageUrlFromRequest,
          userAgent: userAgentHeader ?? null,
          browserName: ua.browserName,
          osName: ua.osName,
          deviceType: ua.deviceType,
          appVersion: env.APP_VERSION,
          userId: actor.id,
          userRole: actor.role.name,
          occurredAt: new Date(),
          triagedAt: null,
          inProgressAt: null,
          resolvedAt: null,
          verifiedAt: null,
          wontFixReason: null,
          createdBy: actor.id,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction: t },
      );

      const attachments = data.attachmentUrls ?? [];
      if (attachments.length > 0) {
        const rebasedUrls = await rebaseAttachmentUrlsToEntity({
          entityType: S3_ENTITY_TYPES.BUG_REPORTS,
          entityId: bug.id,
          purpose: 'attachments',
          urls: attachments.map((a) => a.url),
        });
        await BugReportAttachment.bulkCreate(
          attachments.map((a, index) => ({
            bugReportId: bug.id,
            url: rebasedUrls[index] ?? a.url,
            type: a.type,
            durationSeconds: a.durationSeconds ?? null,
            createdBy: actor.id,
            updatedBy: null,
            deletedBy: null,
          })),
          { transaction: t },
        );
      }

      await logAudit({
        actorId: actor.id,
        action: 'BUG_REPORT_CREATED',
        entityType: 'BugReport',
        entityId: bug.id,
        metadata: { reportNumber, status: bug.status },
        transaction: t,
      });

      const created = await BugReport.findByPk(bug.id, {
        include: [
          { model: User, as: 'reporter', attributes: ['id', 'name'], required: false },
          { model: BugReportAttachment, as: 'attachments', required: false },
        ],
        transaction: t,
      });
      return serializeBugReport(created!, {
        attachments: await serializeAttachments((created as any)?.attachments ?? []),
      });
    });
  }

  private async listWithKeyset(where: WhereOptions, query: KeysetQuery) {
    const cursor = decodeCursor(query.cursor);
    const keysetWhere = buildKeysetWhere(cursor, query.direction);
    const rows = await BugReport.findAll({
      where: keysetWhere ? { [Op.and]: [where, keysetWhere] } : where,
      include: [
        { model: User, as: 'reporter', attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignedTo', attributes: ['id', 'name'], required: false },
      ],
      order: keysetOrder(query.direction),
      limit: query.limit + 1,
    });
    const page = buildKeysetPage(rows, query.limit);
    return {
      items: page.items.map((row) => serializeBugReport(row)),
      nextCursor: page.nextCursor,
    };
  }

  async listMine(actor: Actor, query: MineBugListQuery) {
    const where: WhereOptions = { reporterId: actor.id };
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    return this.listWithKeyset(where, query);
  }

  async listAdmin(query: AdminBugListQuery) {
    const where: WhereOptions = {};
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.affectedModule) where.affectedModule = query.affectedModule;
    if (query.reporterRole) where.reporterRole = query.reporterRole;
    return this.listWithKeyset(where, query);
  }

  async getById(id: string, actor: Actor, transaction?: Transaction) {
    const bug = await BugReport.findByPk(id, {
      include: [
        { model: User, as: 'reporter', attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignedTo', attributes: ['id', 'name'], required: false },
        {
          model: BugReport,
          as: 'duplicateOf',
          attributes: ['id', 'reportNumber'],
          required: false,
        },
        { model: BugReportAttachment, as: 'attachments', required: false },
      ],
      transaction,
    });
    if (!bug) {
      throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
    }

    const permissions = await resolvePermissionsForUser(actor);
    const hasManagePermission = permissions.includes(PERMISSIONS.BUG_REPORT_MANAGE);
    assertBugAccess(bug, actor, hasManagePermission);

    const includeInternal = hasManagePermission;
    const [attachments, timeline] = await Promise.all([
      serializeAttachments((bug as any).attachments ?? []),
      loadBugTimeline(bug.id, includeInternal, transaction),
    ]);

    return serializeBugReport(bug, {
      attachments,
      comments: [],
      timeline,
      includeInternal,
    });
  }

  async triage(id: string, actor: Actor, data: TriageBugReportRequest) {
    await assertBugManagePermission(actor);

    return sequelize.transaction(async (t) => {
      const locked = await BugReport.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }
      assertTransition(locked.status, BUG_REPORT_STATUS.TRIAGED);

      if (data.assignedToId) {
        await usersService.assertAssignableUser(
          data.assignedToId,
          PERMISSIONS.BUG_REPORT_MANAGE,
          t,
        );
      }

      await locked.update(
        {
          severity: data.severity,
          affectedModule: data.affectedModule,
          assignedToId: data.assignedToId ?? locked.assignedToId,
          status: BUG_REPORT_STATUS.TRIAGED,
          triagedAt: new Date(),
          updatedBy: actor.id,
        },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'BUG_REPORT_TRIAGED',
        entityType: 'BugReport',
        entityId: id,
        metadata: {
          severity: data.severity,
          affectedModule: data.affectedModule,
          assignedToId: data.assignedToId ?? null,
        },
        transaction: t,
      });

      void notificationsService.sendBugReportTriaged(locked.reporterId, id, {
        reportNumber: locked.reportNumber,
        title: locked.title,
        actionUrl: bugReportPortalUrl(id, locked.reporterRole),
        reporterRole: locked.reporterRole,
      });

      return this.getById(id, actor, t);
    });
  }

  /** Updates triage fields (severity/module/assignee) without requiring a NEW→TRIAGED transition. */
  async updateAssignment(id: string, actor: Actor, data: UpdateBugAssignmentRequest) {
    await assertBugManagePermission(actor);

    return sequelize.transaction(async (t) => {
      const locked = await BugReport.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }
      if (!ASSIGNMENT_EDITABLE_STATUSES.includes(locked.status)) {
        throw new AppError(
          ERROR_MESSAGES.BUG_INVALID_TRANSITION,
          422,
          ERROR_CODES.BUG_INVALID_TRANSITION,
        );
      }

      if (data.assignedToId) {
        await usersService.assertAssignableUser(
          data.assignedToId,
          PERMISSIONS.BUG_REPORT_MANAGE,
          t,
        );
      }

      await locked.update(
        {
          severity: data.severity,
          affectedModule: data.affectedModule,
          assignedToId: data.assignedToId ?? locked.assignedToId,
          updatedBy: actor.id,
        },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'BUG_REPORT_ASSIGNMENT_UPDATED',
        entityType: 'BugReport',
        entityId: id,
        metadata: {
          severity: data.severity,
          affectedModule: data.affectedModule,
          assignedToId: data.assignedToId ?? null,
        },
        transaction: t,
      });

      return this.getById(id, actor, t);
    });
  }

  async updateStatus(id: string, actor: Actor, data: BugStatusRequest) {
    await assertBugManagePermission(actor);

    return sequelize.transaction(async (t) => {
      const locked = await BugReport.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }

      const next = data.status as BugReportStatus;
      const fromStatus = locked.status as BugReportStatus;
      assertTransition(fromStatus, next);

      const updates: Partial<BugReport> = {
        status: next,
        updatedBy: actor.id,
      };
      if (next === BUG_REPORT_STATUS.IN_PROGRESS && !locked.inProgressAt) {
        updates.inProgressAt = new Date();
      }
      if (next === BUG_REPORT_STATUS.FIXED) {
        updates.resolvedAt = new Date();
      }
      if (next === BUG_REPORT_STATUS.VERIFIED && !locked.verifiedAt) {
        updates.verifiedAt = new Date();
      }

      await locked.update(updates, { transaction: t });

      await logAudit({
        actorId: actor.id,
        action: 'BUG_REPORT_STATUS',
        entityType: 'BugReport',
        entityId: id,
        metadata: { from: fromStatus, to: next, status: next },
        transaction: t,
      });

      if (next === BUG_REPORT_STATUS.FIXED) {
        void notificationsService.sendBugReportFixed(locked.reporterId, id, {
          reportNumber: locked.reportNumber,
          title: locked.title,
          actionUrl: bugReportPortalUrl(id, locked.reporterRole),
          reporterRole: locked.reporterRole,
        });
      }

      return this.getById(id, actor, t);
    });
  }

  async markDuplicate(id: string, actor: Actor, data: DuplicateBugReportRequest) {
    await assertBugManagePermission(actor);
    const ref = normalizeDuplicateRef(data.duplicateOf);
    if (!ref.id && !ref.reportNumber) {
      throw new AppError(
        ERROR_MESSAGES.BUG_DUPLICATE_TARGET_REQUIRED,
        422,
        ERROR_CODES.BUG_DUPLICATE_TARGET_REQUIRED,
      );
    }

    return sequelize.transaction(async (t) => {
      const locked = await BugReport.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }

      const target = ref.id
        ? await BugReport.findByPk(ref.id, { transaction: t })
        : await BugReport.findOne({
            where: { reportNumber: ref.reportNumber },
            transaction: t,
          });
      if (!target) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }
      if (target.id === id) {
        throw new AppError(
          ERROR_MESSAGES.BUG_DUPLICATE_TARGET_INVALID,
          422,
          ERROR_CODES.BUG_DUPLICATE_TARGET_INVALID,
        );
      }
      if (
        target.status === BUG_REPORT_STATUS.DUPLICATE ||
        target.status === BUG_REPORT_STATUS.CLOSED ||
        target.status === BUG_REPORT_STATUS.WONT_FIX
      ) {
        throw new AppError(
          ERROR_MESSAGES.BUG_DUPLICATE_TARGET_INVALID,
          422,
          ERROR_CODES.BUG_DUPLICATE_TARGET_INVALID,
        );
      }

      assertTransition(locked.status, BUG_REPORT_STATUS.DUPLICATE);
      await locked.update(
        {
          status: BUG_REPORT_STATUS.DUPLICATE,
          duplicateOfId: target.id,
          resolvedAt: new Date(),
          updatedBy: actor.id,
        },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'BUG_REPORT_DUPLICATE',
        entityType: 'BugReport',
        entityId: id,
        metadata: {
          duplicateOfId: target.id,
          duplicateOfReportNumber: target.reportNumber,
        },
        transaction: t,
      });

      void notificationsService.sendBugReportDuplicate(locked.reporterId, id, {
        reportNumber: locked.reportNumber,
        title: locked.title,
        actionUrl: bugReportPortalUrl(id, locked.reporterRole),
        reporterRole: locked.reporterRole,
        duplicateOfReportNumber: target.reportNumber,
      });

      return this.getById(id, actor, t);
    });
  }

  async wontFix(id: string, actor: Actor, data: WontFixBugReportRequest) {
    await assertBugManagePermission(actor);
    if (!data.reason?.trim()) {
      throw new AppError(
        ERROR_MESSAGES.BUG_WONT_FIX_REASON_REQUIRED,
        422,
        ERROR_CODES.BUG_WONT_FIX_REASON_REQUIRED,
      );
    }

    return sequelize.transaction(async (t) => {
      const locked = await BugReport.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }
      assertTransition(locked.status, BUG_REPORT_STATUS.WONT_FIX);

      await locked.update(
        {
          status: BUG_REPORT_STATUS.WONT_FIX,
          wontFixReason: data.reason.trim(),
          resolvedAt: new Date(),
          updatedBy: actor.id,
        },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'BUG_REPORT_WONT_FIX',
        entityType: 'BugReport',
        entityId: id,
        metadata: { reason: data.reason.trim() },
        transaction: t,
      });

      void notificationsService.sendBugReportWontFix(locked.reporterId, id, {
        reportNumber: locked.reportNumber,
        title: locked.title,
        actionUrl: bugReportPortalUrl(id, locked.reporterRole),
        reporterRole: locked.reporterRole,
        reason: data.reason.trim(),
      });

      return this.getById(id, actor, t);
    });
  }

  async verify(id: string, actor: Actor) {
    return sequelize.transaction(async (t) => {
      const locked = await BugReport.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }

      const permissions = await resolvePermissionsForUser(actor);
      const hasManagePermission = permissions.includes(PERMISSIONS.BUG_REPORT_MANAGE);
      if (locked.reporterId !== actor.id && !hasManagePermission) {
        throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
      }

      assertTransition(locked.status, BUG_REPORT_STATUS.VERIFIED);
      const now = new Date();
      await locked.update(
        {
          status: BUG_REPORT_STATUS.VERIFIED,
          verifiedAt: now,
          updatedBy: actor.id,
        },
        { transaction: t },
      );
      await logAudit({
        actorId: actor.id,
        action: 'BUG_REPORT_VERIFIED',
        entityType: 'BugReport',
        entityId: id,
        metadata: { status: BUG_REPORT_STATUS.VERIFIED },
        transaction: t,
      });
      return this.getById(id, actor, t);
    });
  }

  /**
   * Auto-verify FIXED bugs past `bugVerifyWindowDays`.
   */
  async markVerifiedIfDue(limit = 100): Promise<number> {
    const settings = await settingsService.getPlatformSettings();
    const cutoff = new Date(
      Date.now() - settings.bugVerifyWindowDays * 24 * 60 * 60 * 1000,
    );
    const due = await BugReport.findAll({
      where: {
        status: BUG_REPORT_STATUS.FIXED,
        resolvedAt: { [Op.lte]: cutoff },
      },
      limit,
    });

    const [actorId] = await findSuperAdminUserIds(1);
    if (!actorId) return 0;

    let count = 0;
    for (const bug of due) {
      const updated = await sequelize.transaction(async (t) => {
        const locked = await BugReport.findByPk(bug.id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!locked || locked.status !== BUG_REPORT_STATUS.FIXED) return false;
        assertTransition(locked.status, BUG_REPORT_STATUS.VERIFIED);
        const now = new Date();
        await locked.update(
          { status: BUG_REPORT_STATUS.VERIFIED, verifiedAt: now },
          { transaction: t },
        );
        await logAudit({
          actorId,
          action: 'BUG_REPORT_AUTO_VERIFIED',
          entityType: 'BugReport',
          entityId: locked.id,
          metadata: {
            from: BUG_REPORT_STATUS.FIXED,
            to: BUG_REPORT_STATUS.VERIFIED,
            automated: true,
          },
          transaction: t,
        });
        return true;
      });
      if (updated) count += 1;
    }
    return count;
  }

  /**
   * Auto-close VERIFIED bugs past `bugCloseWindowDays` (based on verifiedAt).
   */
  async markClosedIfDue(limit = 100): Promise<number> {
    const settings = await settingsService.getPlatformSettings();
    const cutoff = new Date(
      Date.now() - settings.bugCloseWindowDays * 24 * 60 * 60 * 1000,
    );
    const due = await BugReport.findAll({
      where: {
        status: BUG_REPORT_STATUS.VERIFIED,
        verifiedAt: { [Op.lte]: cutoff },
      },
      limit,
    });

    const [actorId] = await findSuperAdminUserIds(1);
    if (!actorId) return 0;

    let count = 0;
    for (const bug of due) {
      const updated = await sequelize.transaction(async (t) => {
        const locked = await BugReport.findByPk(bug.id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!locked || locked.status !== BUG_REPORT_STATUS.VERIFIED) return false;
        assertTransition(locked.status, BUG_REPORT_STATUS.CLOSED);
        await locked.update(
          { status: BUG_REPORT_STATUS.CLOSED, updatedBy: actorId },
          { transaction: t },
        );
        await logAudit({
          actorId,
          action: 'BUG_REPORT_AUTO_CLOSED',
          entityType: 'BugReport',
          entityId: locked.id,
          metadata: {
            from: BUG_REPORT_STATUS.VERIFIED,
            to: BUG_REPORT_STATUS.CLOSED,
            automated: true,
          },
          transaction: t,
        });
        return true;
      });
      if (updated) count += 1;
    }
    return count;
  }

  async addComment(id: string, actor: Actor, data: BugCommentRequest) {
    await assertBugManagePermission(actor);

    return sequelize.transaction(async (t) => {
      const bug = await BugReport.findByPk(id, { transaction: t });
      if (!bug) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }

      const comment = await BugReportComment.create(
        {
          bugReportId: id,
          authorId: actor.id,
          body: data.body,
          createdBy: actor.id,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'BUG_REPORT_COMMENT',
        entityType: 'BugReport',
        entityId: id,
        metadata: { commentId: comment.id },
        transaction: t,
      });

      const withAuthor = await BugReportComment.findByPk(comment.id, {
        include: [{ model: User, as: 'author', attributes: ['id', 'name'], required: false }],
        transaction: t,
      });
      return serializeComment(withAuthor as BugReportComment & { author?: User });
    });
  }

  async listComments(id: string, actor: Actor, query: KeysetQuery) {
    await assertBugManagePermission(actor);
    const bug = await BugReport.findByPk(id);
    if (!bug) {
      throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
    }

    const cursor = decodeCursor(query.cursor);
    const keysetWhere = buildKeysetWhere(cursor, query.direction);
    const rows = await BugReportComment.findAll({
      where: keysetWhere
        ? { [Op.and]: [{ bugReportId: id }, keysetWhere] }
        : { bugReportId: id },
      include: [{ model: User, as: 'author', attributes: ['id', 'name'], required: false }],
      order: keysetOrder(query.direction),
      limit: query.limit + 1,
    });
    const page = buildKeysetPage(rows, query.limit);
    return {
      items: page.items.map((r) =>
        serializeComment(r as BugReportComment & { author?: User }),
      ),
      nextCursor: page.nextCursor,
    };
  }
}

export const bugReportsService = new BugReportsService();
