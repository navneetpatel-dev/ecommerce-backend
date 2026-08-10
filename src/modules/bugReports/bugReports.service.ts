import { Op, type WhereOptions } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import { ValidationError } from '@core/errors/ValidationError';
import {
  ADMIN_ROLES,
  BUG_AFFECTED_MODULE,
  BUG_REPORTER_ROLE,
  BUG_REPORT_SEVERITY,
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
import { settingsService } from '@modules/settings/settings.service';
import { logAudit } from '@modules/audit/audit.service';
import {
  assertAttachmentLimits,
} from '@modules/supportTickets/mediaLimits';
import { assertRemoteVideoBackstop } from '@modules/supportTickets/mediaProbe';
import type {
  AdminBugListQuery,
  BugCommentRequest,
  BugStatusRequest,
  CreateBugReportRequest,
  DuplicateBugReportRequest,
  TriageBugReportRequest,
  WontFixBugReportRequest,
} from './bugReports.dto';

const ALLOWED_TRANSITIONS: Record<BugReportStatus, BugReportStatus[]> = {
  [BUG_REPORT_STATUS.NEW]: [
    BUG_REPORT_STATUS.TRIAGED,
    BUG_REPORT_STATUS.DUPLICATE,
    BUG_REPORT_STATUS.WONT_FIX,
    BUG_REPORT_STATUS.CLOSED,
  ],
  [BUG_REPORT_STATUS.TRIAGED]: [
    BUG_REPORT_STATUS.IN_PROGRESS,
    BUG_REPORT_STATUS.DUPLICATE,
    BUG_REPORT_STATUS.WONT_FIX,
    BUG_REPORT_STATUS.CLOSED,
  ],
  [BUG_REPORT_STATUS.IN_PROGRESS]: [
    BUG_REPORT_STATUS.FIXED,
    BUG_REPORT_STATUS.DUPLICATE,
    BUG_REPORT_STATUS.WONT_FIX,
    BUG_REPORT_STATUS.CLOSED,
  ],
  [BUG_REPORT_STATUS.FIXED]: [
    BUG_REPORT_STATUS.VERIFIED,
    BUG_REPORT_STATUS.CLOSED,
    BUG_REPORT_STATUS.IN_PROGRESS,
  ],
  [BUG_REPORT_STATUS.VERIFIED]: [BUG_REPORT_STATUS.CLOSED],
  [BUG_REPORT_STATUS.CLOSED]: [],
  [BUG_REPORT_STATUS.WONT_FIX]: [],
  [BUG_REPORT_STATUS.DUPLICATE]: [],
};

type Actor = {
  id: string;
  vendorId: string | null;
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
] as const;

function assertTransition(from: BugReportStatus, to: BugReportStatus) {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      ERROR_MESSAGES.BUG_INVALID_TRANSITION,
      422,
      ERROR_CODES.BUG_INVALID_TRANSITION,
    );
  }
}

function isAdminActor(actor: Actor): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(actor.role.name);
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

function serializeAttachment(row: BugReportAttachment) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    bugReportId: plain.bugReportId,
    url: plain.url,
    type: plain.type,
    durationSeconds: plain.durationSeconds ?? null,
    createdAt: plain.createdAt,
  };
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

function serializeBugReport(
  row: BugReport,
  extras: {
    attachments?: ReturnType<typeof serializeAttachment>[];
    comments?: ReturnType<typeof serializeComment>[];
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
    duplicateOfId: plain.duplicateOfId ?? null,
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
    resolvedAt: plain.resolvedAt ?? null,
    wontFixReason: plain.wontFixReason ?? null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    attachments: extras.attachments,
  };

  if (extras.includeInternal) {
    return { ...base, comments: extras.comments ?? [] };
  }
  return base;
}

async function assertBugAccess(bug: BugReport, actor: Actor): Promise<void> {
  if (isAdminActor(actor)) return;
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
          severity: BUG_REPORT_SEVERITY.MEDIUM,
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
          resolvedAt: null,
          wontFixReason: null,
          createdBy: actor.id,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction: t },
      );

      const attachments = data.attachmentUrls ?? [];
      if (attachments.length > 0) {
        await BugReportAttachment.bulkCreate(
          attachments.map((a) => ({
            bugReportId: bug.id,
            url: a.url,
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
      });

      const created = await BugReport.findByPk(bug.id, {
        include: [
          { model: User, as: 'reporter', attributes: ['id', 'name'], required: false },
          { model: BugReportAttachment, as: 'attachments', required: false },
        ],
        transaction: t,
      });
      return serializeBugReport(created!, {
        attachments: ((created as any)?.attachments ?? []).map(serializeAttachment),
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

  async listMine(actor: Actor, query: KeysetQuery) {
    return this.listWithKeyset({ reporterId: actor.id }, query);
  }

  async listAdmin(query: AdminBugListQuery) {
    const where: WhereOptions = {};
    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.affectedModule) where.affectedModule = query.affectedModule;
    if (query.reporterRole) where.reporterRole = query.reporterRole;
    return this.listWithKeyset(where, query);
  }

  async getById(id: string, actor: Actor) {
    const bug = await BugReport.findByPk(id, {
      include: [
        { model: User, as: 'reporter', attributes: ['id', 'name'], required: false },
        { model: User, as: 'assignedTo', attributes: ['id', 'name'], required: false },
        { model: BugReportAttachment, as: 'attachments', required: false },
      ],
    });
    if (!bug) {
      throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
    }
    await assertBugAccess(bug, actor);

    const includeInternal = isAdminActor(actor);
    let comments: ReturnType<typeof serializeComment>[] = [];
    if (includeInternal) {
      const rows = await BugReportComment.findAll({
        where: { bugReportId: id },
        include: [{ model: User, as: 'author', attributes: ['id', 'name'], required: false }],
        order: [
          ['createdAt', 'ASC'],
          ['id', 'ASC'],
        ],
      });
      comments = rows.map((r) => serializeComment(r as BugReportComment & { author?: User }));
    }

    return serializeBugReport(bug, {
      attachments: ((bug as any).attachments ?? []).map(serializeAttachment),
      comments,
      includeInternal,
    });
  }

  async triage(id: string, actor: Actor, data: TriageBugReportRequest) {
    if (!isAdminActor(actor)) {
      throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
    }

    return sequelize.transaction(async (t) => {
      const locked = await BugReport.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }
      assertTransition(locked.status, BUG_REPORT_STATUS.TRIAGED);

      if (data.assignedToId) {
        const assignee = await User.findByPk(data.assignedToId, { transaction: t });
        if (!assignee) throw new ValidationError(ERROR_MESSAGES.NOT_FOUND);
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
      });

      void notificationsService.sendBugReportTriaged(locked.reporterId, id, {
        reportNumber: locked.reportNumber,
        title: locked.title,
      });

      return this.getById(id, actor);
    });
  }

  async updateStatus(id: string, actor: Actor, data: BugStatusRequest) {
    if (!isAdminActor(actor)) {
      throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
    }

    return sequelize.transaction(async (t) => {
      const locked = await BugReport.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }

      const next = data.status as BugReportStatus;
      assertTransition(locked.status, next);

      const updates: Partial<BugReport> = {
        status: next,
        updatedBy: actor.id,
      };
      if (next === BUG_REPORT_STATUS.FIXED) {
        updates.resolvedAt = new Date();
      }

      await locked.update(updates, { transaction: t });

      await logAudit({
        actorId: actor.id,
        action: 'BUG_REPORT_STATUS',
        entityType: 'BugReport',
        entityId: id,
        metadata: { status: next },
      });

      if (next === BUG_REPORT_STATUS.FIXED) {
        void notificationsService.sendBugReportFixed(locked.reporterId, id, {
          reportNumber: locked.reportNumber,
          title: locked.title,
        });
      }

      return this.getById(id, actor);
    });
  }

  async markDuplicate(id: string, actor: Actor, data: DuplicateBugReportRequest) {
    if (!isAdminActor(actor)) {
      throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
    }
    if (!data.duplicateOfId) {
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
      if (data.duplicateOfId === id) {
        throw new ValidationError(ERROR_MESSAGES.BUG_DUPLICATE_TARGET_REQUIRED);
      }

      const target = await BugReport.findByPk(data.duplicateOfId, { transaction: t });
      if (!target) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }

      assertTransition(locked.status, BUG_REPORT_STATUS.DUPLICATE);
      await locked.update(
        {
          status: BUG_REPORT_STATUS.DUPLICATE,
          duplicateOfId: data.duplicateOfId,
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
        metadata: { duplicateOfId: data.duplicateOfId },
      });

      return this.getById(id, actor);
    });
  }

  async wontFix(id: string, actor: Actor, data: WontFixBugReportRequest) {
    if (!isAdminActor(actor)) {
      throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
    }
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
      });

      void notificationsService.sendBugReportWontFix(locked.reporterId, id, {
        reportNumber: locked.reportNumber,
        title: locked.title,
        reason: data.reason.trim(),
      });

      return this.getById(id, actor);
    });
  }

  async verify(id: string, actor: Actor) {
    return sequelize.transaction(async (t) => {
      const locked = await BugReport.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
      }
      if (locked.reporterId !== actor.id && !isAdminActor(actor)) {
        throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
      }
      assertTransition(locked.status, BUG_REPORT_STATUS.VERIFIED);
      await locked.update(
        {
          status: BUG_REPORT_STATUS.VERIFIED,
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
      });
      return this.getById(id, actor);
    });
  }

  /**
   * Auto-verify FIXED bugs past `bugVerifyWindowDays`.
   * Intended for a future scheduler job — safe to call opportunistically.
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

    let count = 0;
    for (const bug of due) {
      await sequelize.transaction(async (t) => {
        const locked = await BugReport.findByPk(bug.id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!locked || locked.status !== BUG_REPORT_STATUS.FIXED) return;
        assertTransition(locked.status, BUG_REPORT_STATUS.VERIFIED);
        await locked.update(
          { status: BUG_REPORT_STATUS.VERIFIED },
          { transaction: t },
        );
        await logAudit({
          actorId: locked.reporterId,
          action: 'BUG_REPORT_AUTO_VERIFIED',
          entityType: 'BugReport',
          entityId: locked.id,
          metadata: {
            from: BUG_REPORT_STATUS.FIXED,
            to: BUG_REPORT_STATUS.VERIFIED,
          },
        });
      });
      count += 1;
    }
    return count;
  }

  async addComment(id: string, actor: Actor, data: BugCommentRequest) {
    if (!isAdminActor(actor)) {
      throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
    }
    const bug = await BugReport.findByPk(id);
    if (!bug) {
      throw new AppError(ERROR_MESSAGES.BUG_NOT_FOUND, 404, ERROR_CODES.BUG_NOT_FOUND);
    }

    const comment = await BugReportComment.create({
      bugReportId: id,
      authorId: actor.id,
      body: data.body,
      createdBy: actor.id,
      updatedBy: null,
      deletedBy: null,
    });

    await logAudit({
      actorId: actor.id,
      action: 'BUG_REPORT_COMMENT',
      entityType: 'BugReport',
      entityId: id,
      metadata: { commentId: comment.id },
    });

    const withAuthor = await BugReportComment.findByPk(comment.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name'], required: false }],
    });
    return serializeComment(withAuthor as BugReportComment & { author?: User });
  }

  async listComments(id: string, actor: Actor, query: KeysetQuery) {
    if (!isAdminActor(actor)) {
      throw new AppError(ERROR_MESSAGES.BUG_FORBIDDEN, 403, ERROR_CODES.BUG_FORBIDDEN);
    }
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
