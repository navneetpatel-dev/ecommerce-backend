import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import { logger } from '@core/logger';
import {
  ADMIN_ROLES,
  DOCUMENT_SEQUENCE_KIND,
  ROLES,
  SUPPORT_TICKET_CATEGORY,
  SUPPORT_TICKET_PRIORITY,
  SUPPORT_TICKET_STATUS,
  TICKET_ATTACHMENT_TYPE,
  TICKET_SENDER_ROLE,
  VENDOR_ROLES,
  type SupportTicketStatus,
  type TicketSenderRole,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { SupportTicket } from '@database/models/supportTicket.model';
import { TicketMessage } from '@database/models/ticketMessage.model';
import { TicketAttachment } from '@database/models/ticketAttachment.model';
import { TicketRead } from '@database/models/ticketRead.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { sequelize } from '@database/models';
import {
  buildKeysetPage,
  buildKeysetWhere,
  decodeCursor,
  keysetOrder,
  type KeysetQuery,
} from '@core/http/keysetPagination';
import { nextPaddedDocumentNumber } from '@modules/pricing/documentSequence';
import { notificationsService } from '@modules/notifications/notifications.service';
import {
  findSuperAdminUserIds,
  findVendorStaffUserId,
} from '@modules/notifications/orderNotifications';
import { ticketPortalUrlForGroup, ticketPortalGroupForUser } from '@modules/notifications/portalLinks';
import { settingsService } from '@modules/settings/settings.service';
import { logAudit } from '@modules/audit/audit.service';
import { usersService } from '@modules/users/users.service';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { rebaseAttachmentUrlsToEntity, S3_ENTITY_TYPES } from '@core/s3';
import { extractS3KeyFromUrl, signedGetObjectUrlMap } from '@config/s3';
import { assertAttachmentLimits, assertCombinedAttachmentLimits } from '@core/media';
import { assertRemoteVideoBackstop } from '@core/media';
import type {
  AdminTicketListQuery,
  CreateSupportTicketRequest,
  CustomerTicketListQuery,
  RateSupportTicketRequest,
  ReplySupportTicketRequest,
  UpdatePriorityRequest,
  VendorTicketListQuery,
} from './supportTickets.dto';
import { SUPPORT_TICKET_SLA_HOURS, TICKET_ALLOWED_TRANSITIONS } from './supportTickets.lifecycle';

type Actor = {
  id: string;
  vendorId: string | null;
  roleId: string;
  role: { name: string };
};

const ticketListInclude = [
  { model: User, as: 'customer', required: false, attributes: ['id', 'name'] },
  { model: User, as: 'assignedTo', required: false, attributes: ['id', 'name'] },
  { model: Vendor, as: 'relatedVendor', required: false, attributes: ['id', 'businessName'] },
];

function assertTransition(from: SupportTicketStatus, to: SupportTicketStatus) {
  const allowed = TICKET_ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError(
      ERROR_MESSAGES.TICKET_INVALID_TRANSITION,
      422,
      ERROR_CODES.TICKET_INVALID_TRANSITION,
    );
  }
}

function toTicketSenderRole(roleName: string): TicketSenderRole {
  if (roleName === ROLES.VENDOR_OWNER) return TICKET_SENDER_ROLE.VENDOR;
  if (roleName === ROLES.VENDOR_STAFF) return TICKET_SENDER_ROLE.VENDOR_STAFF;
  if (roleName === ROLES.CUSTOMER) return TICKET_SENDER_ROLE.CUSTOMER;
  if (roleName === ROLES.SUPER_ADMIN) return TICKET_SENDER_ROLE.SUPER_ADMIN;
  if (roleName === ROLES.ADMIN_ORDER_MANAGER) return TICKET_SENDER_ROLE.ADMIN_ORDER_MANAGER;
  if (roleName === ROLES.ADMIN_CATALOG_MANAGER) return TICKET_SENDER_ROLE.ADMIN_CATALOG_MANAGER;
  if ((ADMIN_ROLES as readonly string[]).includes(roleName)) return TICKET_SENDER_ROLE.ADMIN;
  return TICKET_SENDER_ROLE.CUSTOMER;
}

function isStaffSender(senderRole: string): boolean {
  return senderRole !== TICKET_SENDER_ROLE.CUSTOMER;
}

function isAdminActor(actor: Actor): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(actor.role.name);
}

function isVendorActor(actor: Actor): boolean {
  return (VENDOR_ROLES as readonly string[]).includes(actor.role.name) && Boolean(actor.vendorId);
}

async function serializeAttachments(rows: TicketAttachment[]) {
  const plains = rows.map((row) =>
    typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row,
  );
  const keyByIndex = plains.map((plain) => extractS3KeyFromUrl(plain.url));
  const signedByKey = await signedGetObjectUrlMap(keyByIndex);
  return plains.map((plain, index) => {
    const key = keyByIndex[index];
    return {
      id: plain.id,
      ticketId: plain.ticketId,
      messageId: plain.messageId ?? null,
      url: (key && signedByKey.get(key)) || plain.url,
      type: plain.type,
      durationSeconds: plain.durationSeconds ?? null,
      createdAt: plain.createdAt,
    };
  });
}

type SerializedAttachment = Awaited<ReturnType<typeof serializeAttachments>>[number];

async function serializeMessages(
  rows: Array<TicketMessage & { sender?: User; attachments?: TicketAttachment[] }>,
) {
  const plains = rows.map((row) =>
    typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row,
  );
  const allAttachments = plains.flatMap((plain) =>
    Array.isArray(plain.attachments) ? (plain.attachments as TicketAttachment[]) : [],
  );
  const signedAttachments = await serializeAttachments(allAttachments);
  const byId = new Map(signedAttachments.map((item) => [item.id, item]));

  return plains.map((plain) => ({
    id: plain.id,
    ticketId: plain.ticketId,
    senderId: plain.senderId,
    senderRole: plain.senderRole,
    senderName: plain.sender?.name ?? null,
    body: plain.body,
    createdAt: plain.createdAt,
    attachments: Array.isArray(plain.attachments)
      ? (plain.attachments as TicketAttachment[])
          .map((row) => {
            const id =
              typeof (row as any).get === 'function'
                ? (row as any).get({ plain: true }).id
                : (row as any).id;
            return byId.get(id);
          })
          .filter(Boolean)
      : [],
  }));
}

type SerializedMessage = Awaited<ReturnType<typeof serializeMessages>>[number];

function serializeTicket(
  row: SupportTicket,
  extras: {
    latestMessagePreview?: string | null;
    hasUnread?: boolean;
    messages?: SerializedMessage[];
    attachments?: SerializedAttachment[];
    imageAttachmentCount?: number;
    videoAttachmentCount?: number;
  } = {},
) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    ticketNumber: plain.ticketNumber,
    customerId: plain.customerId,
    customerName: plain.customer?.name ?? null,
    subject: plain.subject,
    description: plain.description,
    category: plain.category,
    relatedOrderId: plain.relatedOrderId ?? null,
    relatedVendorId: plain.relatedVendorId ?? null,
    vendorName: plain.relatedVendor?.businessName ?? null,
    priority: plain.priority,
    status: plain.status,
    assignedToId: plain.assignedToId ?? null,
    assignedToName: plain.assignedTo?.name ?? null,
    firstResponseAt: plain.firstResponseAt ?? null,
    resolvedAt: plain.resolvedAt ?? null,
    closedAt: plain.closedAt ?? null,
    customerSatisfactionRating: plain.customerSatisfactionRating ?? null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    latestMessagePreview: extras.latestMessagePreview ?? null,
    hasUnread: extras.hasUnread ?? false,
    messages: extras.messages,
    attachments: extras.attachments,
    imageAttachmentCount: extras.imageAttachmentCount ?? 0,
    videoAttachmentCount: extras.videoAttachmentCount ?? 0,
  };
}

async function findTicketManagerUserIds(limit = 50): Promise<string[]> {
  const assignees = await usersService.findAssigneesByPermission(
    PERMISSIONS.TICKET_MANAGE,
    limit,
  );
  return assignees.map((u) => u.id);
}

async function markTicketRead(
  ticketId: string,
  userId: string,
  transaction?: Transaction,
) {
  const now = new Date();
  const existing = await TicketRead.findOne({ where: { ticketId, userId }, transaction });
  if (existing) await existing.update({ lastReadAt: now }, { transaction });
  else await TicketRead.create({ ticketId, userId, lastReadAt: now }, { transaction });
}

async function assertTicketAccess(ticket: SupportTicket, actor: Actor): Promise<void> {
  if (isAdminActor(actor)) {
    const permissions = await resolvePermissionsForUser(actor);
    if (permissions.includes(PERMISSIONS.TICKET_MANAGE)) return;
    throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
  }
  if (ticket.customerId === actor.id) return;
  if (isVendorActor(actor) && ticket.relatedVendorId && ticket.relatedVendorId === actor.vendorId) {
    return;
  }
  throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
}

async function assertTicketAssignee(
  ticket: SupportTicket,
  assignedToId: string,
  t?: Transaction,
): Promise<void> {
  await usersService.assertTicketAssignee(assignedToId, ticket.relatedVendorId, t);
}

async function getTicketOrThrow(id: string, transaction?: Transaction): Promise<SupportTicket> {
  const ticket = await SupportTicket.findByPk(id, {
    include: ticketListInclude,
    transaction,
  });
  if (!ticket) {
    throw new AppError(ERROR_MESSAGES.TICKET_NOT_FOUND, 404, ERROR_CODES.TICKET_NOT_FOUND);
  }
  return ticket;
}

export class SupportTicketsService {
  async create(actor: Actor, data: CreateSupportTicketRequest) {
    if (actor.role.name !== ROLES.CUSTOMER) {
      throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
    }
    assertAttachmentLimits(data.attachmentUrls ?? [], 'ticket');
    await assertRemoteVideoBackstop(data.attachmentUrls ?? [], 'ticket');

    return sequelize.transaction(async (t) => {
      const ticketNumber = await nextPaddedDocumentNumber(
        DOCUMENT_SEQUENCE_KIND.SUPPORT_TICKET,
        t,
      );

      let relatedOrderId = data.relatedOrderId ?? null;
      let relatedVendorId: string | null = null;
      const clientVendorId = data.relatedVendorId ?? null;

      if (relatedOrderId) {
        const order = await Order.findByPk(relatedOrderId, {
          include: [{ model: SubOrder, as: 'subOrders', attributes: ['vendorId'] }],
          transaction: t,
        });
        if (!order || order.userId !== actor.id) {
          throw new AppError(ERROR_MESSAGES.NOT_YOUR_ORDER, 403, ERROR_CODES.FORBIDDEN);
        }
        const vendorIds = [
          ...new Set(
            ((order as Order & { subOrders?: SubOrder[] }).subOrders ?? []).map((s) => s.vendorId),
          ),
        ];
        if (vendorIds.length === 1) {
          relatedVendorId = vendorIds[0]!;
          if (clientVendorId && clientVendorId !== relatedVendorId) {
            throw new AppError(
              ERROR_MESSAGES.TICKET_VENDOR_INVALID,
              422,
              ERROR_CODES.TICKET_VENDOR_INVALID,
            );
          }
        } else if (vendorIds.length > 1) {
          if (!clientVendorId) {
            throw new AppError(
              ERROR_MESSAGES.TICKET_VENDOR_REQUIRED,
              422,
              ERROR_CODES.TICKET_VENDOR_REQUIRED,
            );
          }
          if (!vendorIds.includes(clientVendorId)) {
            throw new AppError(
              ERROR_MESSAGES.TICKET_VENDOR_INVALID,
              422,
              ERROR_CODES.TICKET_VENDOR_INVALID,
            );
          }
          relatedVendorId = clientVendorId;
        }
      } else {
        relatedOrderId = null;
        if (data.category === SUPPORT_TICKET_CATEGORY.VENDOR) {
          if (!clientVendorId) {
            throw new AppError(
              ERROR_MESSAGES.TICKET_VENDOR_REQUIRED,
              422,
              ERROR_CODES.TICKET_VENDOR_REQUIRED,
            );
          }
          const vendor = await Vendor.findByPk(clientVendorId, { transaction: t });
          if (!vendor) {
            throw new AppError(
              ERROR_MESSAGES.TICKET_VENDOR_INVALID,
              422,
              ERROR_CODES.TICKET_VENDOR_INVALID,
            );
          }
          relatedVendorId = clientVendorId;
        } else {
          relatedVendorId = null;
        }
      }

      const assignedToId = relatedVendorId
        ? await findVendorStaffUserId(relatedVendorId)
        : null;

      const ticket = await SupportTicket.create(
        {
          ticketNumber,
          customerId: actor.id,
          subject: data.subject,
          description: data.description,
          category: data.category,
          relatedOrderId,
          relatedVendorId,
          priority: SUPPORT_TICKET_PRIORITY.MEDIUM,
          status: SUPPORT_TICKET_STATUS.OPEN,
          assignedToId,
          firstResponseAt: null,
          resolvedAt: null,
          closedAt: null,
          customerSatisfactionRating: null,
          createdBy: actor.id,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction: t },
      );

      const message = await TicketMessage.create(
        {
          ticketId: ticket.id,
          senderId: actor.id,
          senderRole: TICKET_SENDER_ROLE.CUSTOMER,
          body: data.description,
          createdBy: actor.id,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction: t },
      );

      const attachments = data.attachmentUrls ?? [];
      if (attachments.length > 0) {
        const rawUrls = attachments.map((a) => a.url);
        const rebased = await rebaseAttachmentUrlsToEntity({
          entityType: S3_ENTITY_TYPES.TICKETS,
          entityId: ticket.id,
          purpose: 'attachments',
          urls: rawUrls,
        });
        await TicketAttachment.bulkCreate(
          attachments.map((a, i) => ({
            ticketId: ticket.id,
            messageId: message.id,
            url: rebased[i] ?? a.url,
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
        action: 'SUPPORT_TICKET_CREATED',
        entityType: 'SupportTicket',
        entityId: ticket.id,
        metadata: {
          ticketNumber,
          status: ticket.status,
          assignedToId,
          relatedVendorId,
        },
        transaction: t,
      });
      if (assignedToId) {
        await logAudit({
          actorId: actor.id,
          action: 'SUPPORT_TICKET_ASSIGNED',
          entityType: 'SupportTicket',
          entityId: ticket.id,
          metadata: { from: null, to: assignedToId, automated: true },
          transaction: t,
        });
      }

      const notifyIds = new Set<string>();
      let recipientGroup: 'vendor' | 'admin' = 'admin';
      if (ticket.relatedVendorId && assignedToId) {
        notifyIds.add(assignedToId);
        recipientGroup = 'vendor';
      } else {
        // Vendor-implicated tickets with no staff, and admin-queue tickets, notify ticket managers.
        for (const id of await findTicketManagerUserIds()) notifyIds.add(id);
        recipientGroup = 'admin';
      }

      for (const userId of notifyIds) {
        void notificationsService.sendTicketCreated(userId, ticket.id, {
          ticketNumber,
          subject: ticket.subject,
          actionUrl: ticketPortalUrlForGroup(ticket.id, recipientGroup),
          portalGroup: recipientGroup,
        });
      }

      const created = await getTicketOrThrow(ticket.id, t);
      return serializeTicket(created, {
        latestMessagePreview: data.description.slice(0, 160),
      });
    });
  }

  private async listWithKeyset(
    where: WhereOptions,
    query: KeysetQuery,
    actor: Actor,
  ) {
    const cursor = decodeCursor(query.cursor);
    const keysetWhere = buildKeysetWhere(cursor, query.direction);
    const actorIdLiteral = sequelize.escape(actor.id);
    const rows = await SupportTicket.findAll({
      where: keysetWhere ? { [Op.and]: [where, keysetWhere] } : where,
      attributes: {
        include: [
          // One correlated subquery for latest-message fields (was 3 separate subselects).
          [
            sequelize.literal(`(
              SELECT json_build_object(
                'body', tm.body,
                'senderId', tm."senderId",
                'createdAt', tm."createdAt"
              )
              FROM ticket_messages tm
              WHERE tm."ticketId" = "SupportTicket".id AND tm."deletedAt" IS NULL
              ORDER BY tm."createdAt" DESC, tm.id DESC
              LIMIT 1
            )`),
            'latestMessageMeta',
          ],
          [
            sequelize.literal(`(
              SELECT tr."lastReadAt" FROM ticket_reads tr
              WHERE tr."ticketId" = "SupportTicket".id AND tr."userId" = ${actorIdLiteral}
              LIMIT 1
            )`),
            'lastReadAt',
          ],
        ],
      },
      include: ticketListInclude,
      order: keysetOrder(query.direction),
      limit: query.limit + 1,
    });
    const page = buildKeysetPage(rows, query.limit);
    return {
      items: page.items.map((row) => {
        const plain: any =
          typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
        const metaRaw = plain.latestMessageMeta ?? (row as any).get?.('latestMessageMeta') ?? null;
        const meta =
          typeof metaRaw === 'string'
            ? (JSON.parse(metaRaw) as {
                body?: string;
                senderId?: string;
                createdAt?: string;
              })
            : metaRaw && typeof metaRaw === 'object'
              ? (metaRaw as { body?: string; senderId?: string; createdAt?: string })
              : null;
        const previewRaw = meta?.body ?? null;
        const previewSenderId = meta?.senderId ?? null;
        const latestAt = meta?.createdAt ?? null;
        const lastReadAt = plain.lastReadAt ?? (row as any).get?.('lastReadAt') ?? null;
        const hasUnread = Boolean(
          previewSenderId &&
            previewSenderId !== actor.id &&
            (!lastReadAt || (latestAt && new Date(latestAt) > new Date(lastReadAt))),
        );
        return serializeTicket(row, {
          latestMessagePreview:
            typeof previewRaw === 'string' ? previewRaw.slice(0, 160) : previewRaw,
          hasUnread,
        });
      }),
      nextCursor: page.nextCursor,
    };
  }

  async listMine(actor: Actor, query: CustomerTicketListQuery) {
    const where: WhereOptions = { customerId: actor.id };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.category) where.category = query.category;
    return this.listWithKeyset(where, query, actor);
  }

  async listVendor(actor: Actor, query: VendorTicketListQuery) {
    if (!isVendorActor(actor)) {
      throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
    }
    const filters: WhereOptions = {
      relatedVendorId: actor.vendorId,
    };
    const extras: WhereOptions = {};
    if (query.status) extras.status = query.status;
    if (query.priority) extras.priority = query.priority;
    if (query.category) extras.category = query.category;
    const where: WhereOptions =
      Object.keys(extras).length > 0 ? { [Op.and]: [filters, extras] } : filters;
    return this.listWithKeyset(where, query, actor);
  }

  async listAdmin(query: AdminTicketListQuery, actor: Actor) {
    const where: WhereOptions = {};
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.category) where.category = query.category;
    if (query.vendorId) where.relatedVendorId = query.vendorId;
    return this.listWithKeyset(where, query, actor);
  }

  /**
   * Ticket-level metadata + description attachments only. Message history is intentionally
   * NOT embedded here — the FE conversation view always uses `listMessages` (keyset paginated),
   * so eagerly loading messages here would be redundant work on every ticket page load.
   */
  async getById(id: string, actor: Actor) {
    const ticket = await getTicketOrThrow(id);
    await assertTicketAccess(ticket, actor);
    await markTicketRead(id, actor.id);

    const firstMessage = await TicketMessage.findOne({
      where: { ticketId: id },
      attributes: ['id'],
      order: [
        ['createdAt', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const [descriptionAttachments, imageAttachmentCount, videoAttachmentCount] = await Promise.all([
      firstMessage
        ? TicketAttachment.findAll({
            where: { ticketId: id, messageId: firstMessage.id },
            order: [['createdAt', 'ASC']],
          })
        : Promise.resolve([] as TicketAttachment[]),
      TicketAttachment.count({
        where: { ticketId: id, type: TICKET_ATTACHMENT_TYPE.IMAGE },
      }),
      TicketAttachment.count({
        where: { ticketId: id, type: TICKET_ATTACHMENT_TYPE.VIDEO },
      }),
    ]);

    return serializeTicket(ticket, {
      attachments: await serializeAttachments(descriptionAttachments),
      imageAttachmentCount,
      videoAttachmentCount,
    });
  }

  async listMessages(id: string, actor: Actor, query: KeysetQuery) {
    const ticket = await getTicketOrThrow(id);
    await assertTicketAccess(ticket, actor);
    await markTicketRead(id, actor.id);

    const cursor = decodeCursor(query.cursor);
    const keysetWhere = buildKeysetWhere(cursor, query.direction ?? 'older');
    const rows = await TicketMessage.findAll({
      where: keysetWhere
        ? { [Op.and]: [{ ticketId: id }, keysetWhere] }
        : { ticketId: id },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name'], required: false },
        { model: TicketAttachment, as: 'attachments', required: false },
      ],
      order: keysetOrder(query.direction ?? 'older'),
      limit: query.limit + 1,
    });
    const page = buildKeysetPage(rows, query.limit);
    return {
      items: await serializeMessages(
        page.items as Array<TicketMessage & { sender?: User; attachments?: TicketAttachment[] }>,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async reply(id: string, actor: Actor, data: ReplySupportTicketRequest) {
    return sequelize.transaction(async (t) => {
      const locked = await SupportTicket.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.TICKET_NOT_FOUND, 404, ERROR_CODES.TICKET_NOT_FOUND);
      }
      await assertTicketAccess(locked, actor);

      if (
        locked.status === SUPPORT_TICKET_STATUS.CLOSED ||
        locked.status === SUPPORT_TICKET_STATUS.RESOLVED
      ) {
        throw new AppError(
          ERROR_MESSAGES.TICKET_MUST_REOPEN,
          422,
          ERROR_CODES.TICKET_MUST_REOPEN,
        );
      }

      const existingAttachments = await TicketAttachment.findAll({
        where: { ticketId: id },
        transaction: t,
      });
      assertCombinedAttachmentLimits(
        existingAttachments.map((a) => ({ type: a.type, durationSeconds: a.durationSeconds })),
        data.attachmentUrls ?? [],
        'ticket',
      );
      await assertRemoteVideoBackstop(data.attachmentUrls ?? [], 'ticket');

      const senderRole = toTicketSenderRole(actor.role.name);
      const message = await TicketMessage.create(
        {
          ticketId: id,
          senderId: actor.id,
          senderRole,
          body: data.body,
          createdBy: actor.id,
          updatedBy: null,
          deletedBy: null,
        },
        { transaction: t },
      );

      const attachments = data.attachmentUrls ?? [];
      if (attachments.length > 0) {
        const rebased = await rebaseAttachmentUrlsToEntity({
          entityType: S3_ENTITY_TYPES.TICKETS,
          entityId: id,
          purpose: 'attachments',
          urls: attachments.map((a) => a.url),
        });
        await TicketAttachment.bulkCreate(
          attachments.map((a, i) => ({
            ticketId: id,
            messageId: message.id,
            url: rebased[i] ?? a.url,
            type: a.type,
            durationSeconds: a.durationSeconds ?? null,
            createdBy: actor.id,
            updatedBy: null,
            deletedBy: null,
          })),
          { transaction: t },
        );
      }

      const updates: Partial<SupportTicket> = { updatedBy: actor.id };
      if (
        isStaffSender(senderRole) &&
        (locked.status === SUPPORT_TICKET_STATUS.OPEN ||
          locked.status === SUPPORT_TICKET_STATUS.REOPENED)
      ) {
        assertTransition(locked.status, SUPPORT_TICKET_STATUS.IN_PROGRESS);
        updates.status = SUPPORT_TICKET_STATUS.IN_PROGRESS;
        if (!locked.firstResponseAt) {
          updates.firstResponseAt = new Date();
        }
      }

      await locked.update(updates, { transaction: t });

      await logAudit({
        actorId: actor.id,
        action: 'SUPPORT_TICKET_REPLIED',
        entityType: 'SupportTicket',
        entityId: id,
        metadata: { messageId: message.id, status: updates.status ?? locked.status },
        transaction: t,
      });

      const notifyRecipients = new Map<string, 'customer' | 'vendor' | 'admin' | 'lookup'>();
      if (actor.id !== locked.customerId) notifyRecipients.set(locked.customerId, 'customer');
      if (locked.assignedToId && locked.assignedToId !== actor.id) {
        notifyRecipients.set(locked.assignedToId, 'lookup');
      } else if (locked.relatedVendorId) {
        const staffId = await findVendorStaffUserId(locked.relatedVendorId);
        if (staffId && staffId !== actor.id) notifyRecipients.set(staffId, 'vendor');
      } else if (senderRole === TICKET_SENDER_ROLE.CUSTOMER) {
        for (const adminId of await findTicketManagerUserIds()) {
          if (adminId !== actor.id) notifyRecipients.set(adminId, 'admin');
        }
      }

      for (const [userId, group] of notifyRecipients) {
        const portalGroup =
          group === 'lookup' ? await ticketPortalGroupForUser(userId) : group;
        const actionUrl = ticketPortalUrlForGroup(id, portalGroup);
        void notificationsService.sendTicketReplied(userId, id, {
          ticketNumber: locked.ticketNumber,
          subject: locked.subject,
          actionUrl,
          portalGroup,
          messageId: message.id,
        });
      }

      const ticket = await getTicketOrThrow(id, t);
      return serializeTicket(ticket);
    });
  }

  async resolve(id: string, actor: Actor) {
    return sequelize.transaction(async (t) => {
      const locked = await SupportTicket.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.TICKET_NOT_FOUND, 404, ERROR_CODES.TICKET_NOT_FOUND);
      }

      await assertTicketAccess(locked, actor);
      if (!isAdminActor(actor) && !isVendorActor(actor)) {
        throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
      }

      assertTransition(locked.status, SUPPORT_TICKET_STATUS.RESOLVED);
      const now = new Date();
      await locked.update(
        {
          status: SUPPORT_TICKET_STATUS.RESOLVED,
          resolvedAt: now,
          firstResponseAt: locked.firstResponseAt ?? now,
          updatedBy: actor.id,
        },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'SUPPORT_TICKET_RESOLVED',
        entityType: 'SupportTicket',
        entityId: id,
        metadata: { status: SUPPORT_TICKET_STATUS.RESOLVED },
        transaction: t,
      });

      void notificationsService.sendTicketResolved(locked.customerId, id, {
        ticketNumber: locked.ticketNumber,
        subject: locked.subject,
        actionUrl: ticketPortalUrlForGroup(id, 'customer'),
        portalGroup: 'customer',
        resolvedAt: now.toISOString(),
      });

      return serializeTicket(await getTicketOrThrow(id, t));
    });
  }

  async reopen(id: string, actor: Actor) {
    return sequelize.transaction(async (t) => {
      const locked = await SupportTicket.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.TICKET_NOT_FOUND, 404, ERROR_CODES.TICKET_NOT_FOUND);
      }
      if (locked.customerId !== actor.id) {
        throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
      }

      assertTransition(locked.status, SUPPORT_TICKET_STATUS.REOPENED);

      const settings = await settingsService.getPlatformSettings();
      const windowDays = settings.ticketReopenWindowDays;
      const resolvedAt = locked.resolvedAt ? new Date(locked.resolvedAt).getTime() : 0;
      const maxMs = windowDays * 24 * 60 * 60 * 1000;
      if (!resolvedAt || Date.now() - resolvedAt > maxMs) {
        throw new AppError(
          ERROR_MESSAGES.TICKET_REOPEN_WINDOW_EXPIRED,
          422,
          ERROR_CODES.TICKET_REOPEN_WINDOW_EXPIRED,
        );
      }

      await locked.update(
        {
          status: SUPPORT_TICKET_STATUS.REOPENED,
          resolvedAt: null,
          closedAt: null,
          updatedBy: actor.id,
        },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'SUPPORT_TICKET_REOPENED',
        entityType: 'SupportTicket',
        entityId: id,
        metadata: { status: SUPPORT_TICKET_STATUS.REOPENED },
        transaction: t,
      });

      const notifyRecipients = new Map<string, 'vendor' | 'admin' | 'lookup'>();
      if (locked.assignedToId) notifyRecipients.set(locked.assignedToId, 'lookup');
      else if (locked.relatedVendorId) {
        const staffId = await findVendorStaffUserId(locked.relatedVendorId);
        if (staffId) notifyRecipients.set(staffId, 'vendor');
      } else {
        for (const adminId of await findTicketManagerUserIds()) {
          notifyRecipients.set(adminId, 'admin');
        }
      }

      for (const [userId, group] of notifyRecipients) {
        const portalGroup =
          group === 'lookup' ? await ticketPortalGroupForUser(userId) : group;
        const actionUrl = ticketPortalUrlForGroup(id, portalGroup);
        void notificationsService.sendTicketReopened(userId, id, {
          ticketNumber: locked.ticketNumber,
          subject: locked.subject,
          actionUrl,
          portalGroup,
          reopenedAt: new Date().toISOString(),
        });
      }

      return serializeTicket(await getTicketOrThrow(id, t));
    });
  }

  async close(id: string, actor: Actor) {
    return sequelize.transaction(async (t) => {
      const locked = await SupportTicket.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.TICKET_NOT_FOUND, 404, ERROR_CODES.TICKET_NOT_FOUND);
      }
      if (!isAdminActor(actor)) {
        throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
      }

      assertTransition(locked.status, SUPPORT_TICKET_STATUS.CLOSED);
      await locked.update(
        {
          status: SUPPORT_TICKET_STATUS.CLOSED,
          closedAt: new Date(),
          updatedBy: actor.id,
        },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'SUPPORT_TICKET_CLOSED',
        entityType: 'SupportTicket',
        entityId: id,
        metadata: { status: SUPPORT_TICKET_STATUS.CLOSED },
        transaction: t,
      });

      return serializeTicket(await getTicketOrThrow(id, t));
    });
  }

  async reassign(id: string, actor: Actor, assignedToId: string) {
    return sequelize.transaction(async (t) => {
      const locked = await SupportTicket.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.TICKET_NOT_FOUND, 404, ERROR_CODES.TICKET_NOT_FOUND);
      }
      if (!isAdminActor(actor)) {
        throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
      }

      await assertTicketAssignee(locked, assignedToId, t);

      const fromAssignee = locked.assignedToId;
      await locked.update(
        { assignedToId, updatedBy: actor.id },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'SUPPORT_TICKET_REASSIGNED',
        entityType: 'SupportTicket',
        entityId: id,
        metadata: { from: fromAssignee, to: assignedToId },
        transaction: t,
      });

      return serializeTicket(await getTicketOrThrow(id, t));
    });
  }

  async escalate(id: string, actor: Actor) {
    return sequelize.transaction(async (t) => {
      const locked = await SupportTicket.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.TICKET_NOT_FOUND, 404, ERROR_CODES.TICKET_NOT_FOUND);
      }
      if (!isAdminActor(actor)) {
        throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
      }

      const fromPriority = locked.priority;
      const toPriority = SUPPORT_TICKET_PRIORITY.URGENT;
      const fromAssignee = locked.assignedToId;
      const [adminAssigneeId] = await findTicketManagerUserIds(1);
      const updates: {
        priority: typeof toPriority;
        updatedBy: string;
        assignedToId?: string | null;
      } = {
        priority: toPriority,
        updatedBy: actor.id,
      };
      // Escalate into the admin queue when a ticket manager is available.
      if (adminAssigneeId && fromAssignee !== adminAssigneeId) {
        updates.assignedToId = adminAssigneeId;
      }

      await locked.update(updates, { transaction: t });

      await logAudit({
        actorId: actor.id,
        action: 'SUPPORT_TICKET_ESCALATED',
        entityType: 'SupportTicket',
        entityId: id,
        metadata: {
          from: fromPriority,
          to: toPriority,
          fromAssignee,
          toAssignee: updates.assignedToId ?? fromAssignee,
        },
        transaction: t,
      });

      return serializeTicket(await getTicketOrThrow(id, t));
    });
  }

  async updatePriority(id: string, actor: Actor, data: UpdatePriorityRequest) {
    return sequelize.transaction(async (t) => {
      const locked = await SupportTicket.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.TICKET_NOT_FOUND, 404, ERROR_CODES.TICKET_NOT_FOUND);
      }
      if (!isAdminActor(actor)) {
        throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
      }

      const fromPriority = locked.priority;
      await locked.update(
        { priority: data.priority, updatedBy: actor.id },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'SUPPORT_TICKET_PRIORITY_UPDATED',
        entityType: 'SupportTicket',
        entityId: id,
        metadata: { from: fromPriority, to: data.priority },
        transaction: t,
      });

      return serializeTicket(await getTicketOrThrow(id, t));
    });
  }

  async rate(id: string, actor: Actor, data: RateSupportTicketRequest) {
    return sequelize.transaction(async (t) => {
      const locked = await SupportTicket.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) {
        throw new AppError(ERROR_MESSAGES.TICKET_NOT_FOUND, 404, ERROR_CODES.TICKET_NOT_FOUND);
      }
      if (locked.customerId !== actor.id) {
        throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
      }
      const ratable =
        locked.status === SUPPORT_TICKET_STATUS.RESOLVED ||
        (locked.status === SUPPORT_TICKET_STATUS.CLOSED && locked.resolvedAt != null);
      if (!ratable || locked.customerSatisfactionRating != null) {
        throw new AppError(
          ERROR_MESSAGES.TICKET_RATE_NOT_ALLOWED,
          422,
          ERROR_CODES.TICKET_RATE_NOT_ALLOWED,
        );
      }

      await locked.update(
        {
          customerSatisfactionRating: data.rating,
          updatedBy: actor.id,
        },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'SUPPORT_TICKET_RATED',
        entityType: 'SupportTicket',
        entityId: id,
        metadata: { rating: data.rating },
        transaction: t,
      });

      return serializeTicket(await getTicketOrThrow(id, t));
    });
  }

  /**
   * Auto-close RESOLVED tickets past the reopen window.
   * Called from the notification scheduler tick.
   */
  async closeExpiredResolved(limit = 100): Promise<number> {
    const settings = await settingsService.getPlatformSettings();
    const cutoff = new Date(
      Date.now() - settings.ticketReopenWindowDays * 24 * 60 * 60 * 1000,
    );
    const due = await SupportTicket.findAll({
      where: {
        status: SUPPORT_TICKET_STATUS.RESOLVED,
        resolvedAt: { [Op.lte]: cutoff },
      },
      limit,
    });

    const [superAdminId] = await findSuperAdminUserIds(1);
    if (!superAdminId) return 0;

    let count = 0;
    for (const ticket of due) {
      const updated = await sequelize.transaction(async (t) => {
        const locked = await SupportTicket.findByPk(ticket.id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!locked || locked.status !== SUPPORT_TICKET_STATUS.RESOLVED) return false;
        assertTransition(locked.status, SUPPORT_TICKET_STATUS.CLOSED);
        await locked.update(
          {
            status: SUPPORT_TICKET_STATUS.CLOSED,
            closedAt: new Date(),
            updatedBy: superAdminId,
          },
          { transaction: t },
        );
        await logAudit({
          actorId: superAdminId,
          action: 'SUPPORT_TICKET_AUTO_CLOSED',
          entityType: 'SupportTicket',
          entityId: locked.id,
          metadata: {
            from: SUPPORT_TICKET_STATUS.RESOLVED,
            to: SUPPORT_TICKET_STATUS.CLOSED,
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
   * Auto-escalate OPEN, unassigned tickets past `SUPPORT_TICKET_SLA_HOURS`.
   * Reuses `escalate()` verbatim — the exact same priority-bump + queue-reassignment
   * logic the manual `POST /:id/escalate` endpoint uses — so this job cannot drift
   * from that behavior. Called from the notification scheduler tick.
   */
  async escalateOverdueTickets(limit = 100): Promise<number> {
    const cutoff = new Date(Date.now() - SUPPORT_TICKET_SLA_HOURS * 60 * 60 * 1000);
    const due = await SupportTicket.findAll({
      where: {
        status: SUPPORT_TICKET_STATUS.OPEN,
        assignedToId: null,
        priority: { [Op.ne]: SUPPORT_TICKET_PRIORITY.URGENT },
        createdAt: { [Op.lte]: cutoff },
      },
      limit,
    });
    if (due.length === 0) return 0;

    const [superAdminId] = await findSuperAdminUserIds(1);
    if (!superAdminId) return 0;

    const systemActor: Actor = {
      id: superAdminId,
      vendorId: null,
      roleId: '',
      role: { name: ROLES.SUPER_ADMIN },
    };

    let count = 0;
    for (const ticket of due) {
      try {
        await this.escalate(ticket.id, systemActor);
        count += 1;
      } catch (err) {
        // Ticket may have changed state concurrently (picked up/resolved) — skip and continue.
        logger.warn('Auto-escalation skipped for ticket', {
          ticketId: ticket.id,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
    return count;
  }
}

export const supportTicketsService = new SupportTicketsService();
