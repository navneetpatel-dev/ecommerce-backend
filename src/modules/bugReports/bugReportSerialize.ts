/** How bug reports, their attachments, comments and timeline are sent to clients. */
import { Op, type Transaction } from 'sequelize';
import { AuditLog } from '@database/models/auditLog.model';
import type { BugReport } from '@database/models/bugReport.model';
import type { BugReportAttachment } from '@database/models/bugReportAttachment.model';
import type { BugReportComment } from '@database/models/bugReportComment.model';
import type { User } from '@database/models/user.model';
import { toPlain } from '@core/repository/toPlain';
import { extractS3KeyFromUrl, signedGetObjectUrlMap } from '@config/s3';

type PlainAttachment = {
  id: string;
  bugReportId: string;
  url: string;
  type: string;
  durationSeconds?: number | null;
  createdAt: Date;
};

type PlainComment = {
  id: string;
  bugReportId: string;
  authorId: string;
  author?: { name?: string } | null;
  body: string;
  createdAt: Date;
};

type PlainBug = {
  id: string;
  reportNumber: string;
  reporterId: string;
  reporterRole: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  affectedModule: string;
  userId: string;
  userRole: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  stepsToReproduce?: string | null;
  duplicateOfId?: string | null;
  assignedToId?: string | null;
  pageUrl?: string | null;
  userAgent?: string | null;
  browserName?: string | null;
  osName?: string | null;
  deviceType?: string | null;
  appVersion?: string | null;
  triagedAt?: Date | null;
  inProgressAt?: Date | null;
  resolvedAt?: Date | null;
  verifiedAt?: Date | null;
  wontFixReason?: string | null;
  reporter?: { name?: string } | null;
  assignedTo?: { name?: string } | null;
  duplicateOf?: { id?: string; reportNumber?: string } | null;
};

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

export async function serializeAttachments(rows: BugReportAttachment[]) {
  const plains = rows.map((row) => toPlain<PlainAttachment>(row));
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

export function serializeComment(row: BugReportComment & { author?: User }) {
  const plain = toPlain<PlainComment>(row);
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

export async function loadBugTimeline(
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
    const plain = toPlain<{ action: string; createdAt: string | Date; metadata?: unknown }>(row);
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

export function serializeBugReport(
  row: BugReport,
  extras: {
    attachments?: SerializedAttachment[];
    comments?: ReturnType<typeof serializeComment>[];
    timeline?: TimelineEntry[];
    includeInternal?: boolean;
  } = {},
) {
  const plain = toPlain<PlainBug>(row);
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
