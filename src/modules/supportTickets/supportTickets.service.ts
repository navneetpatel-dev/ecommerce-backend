import { Op, QueryTypes, type Transaction, type WhereOptions } from 'sequelize';
import { AppError } from '@core/errors/AppError';
import {
  ADMIN_ROLES,
  DOCUMENT_SEQUENCE_KIND,
  ROLES,
  SUPPORT_TICKET_PRIORITY,
  SUPPORT_TICKET_STATUS,
  TICKET_SENDER_ROLE,
  VENDOR_ROLES,
  type SupportTicketStatus,
  type TicketSenderRole,
} from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { SupportTicket } from '@database/models/supportTicket.model';
import { TicketMessage } from '@database/models/ticketMessage.model';
import { TicketAttachment } from '@database/models/ticketAttachment.model';
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
import { findVendorOwnerUserId } from '@modules/notifications/orderNotifications';
import { settingsService } from '@modules/settings/settings.service';
import { logAudit } from '@modules/audit/audit.service';
import { usersService } from '@modules/users/users.service';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { assertAttachmentLimits, assertCombinedAttachmentLimits } from './mediaLimits';
import { assertRemoteVideoBackstop } from './mediaProbe';
import type {
  AdminTicketListQuery,
  CreateSupportTicketRequest,
  RateSupportTicketRequest,
  ReplySupportTicketRequest,
  VendorTicketListQuery,
} from './supportTickets.dto';

const ALLOWED_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  [SUPPORT_TICKET_STATUS.OPEN]: [
    SUPPORT_TICKET_STATUS.IN_PROGRESS,
    SUPPORT_TICKET_STATUS.RESOLVED,
    SUPPORT_TICKET_STATUS.CLOSED,
  ],
  [SUPPORT_TICKET_STATUS.IN_PROGRESS]: [
    SUPPORT_TICKET_STATUS.RESOLVED,
    SUPPORT_TICKET_STATUS.CLOSED,
  ],
  [SUPPORT_TICKET_STATUS.RESOLVED]: [
    SUPPORT_TICKET_STATUS.REOPENED,
    SUPPORT_TICKET_STATUS.CLOSED,
  ],
  [SUPPORT_TICKET_STATUS.REOPENED]: [
    SUPPORT_TICKET_STATUS.IN_PROGRESS,
    SUPPORT_TICKET_STATUS.RESOLVED,
    SUPPORT_TICKET_STATUS.CLOSED,
  ],
  [SUPPORT_TICKET_STATUS.CLOSED]: [],
};

type Actor = {
  id: string;
  vendorId: string | null;
  role: { name: string };
};

const ticketListInclude = [
  { model: User, as: 'customer', required: false, attributes: ['id', 'name'] },
  { model: User, as: 'assignedTo', required: false, attributes: ['id', 'name'] },
  { model: Vendor, as: 'relatedVendor', required: false, attributes: ['id', 'businessName'] },
];

function assertTransition(from: SupportTicketStatus, to: SupportTicketStatus) {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
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

function serializeAttachment(row: TicketAttachment) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    ticketId: plain.ticketId,
    messageId: plain.messageId ?? null,
    url: plain.url,
    type: plain.type,
    durationSeconds: plain.durationSeconds ?? null,
    createdAt: plain.createdAt,
  };
}

function serializeMessage(row: TicketMessage & { sender?: User; attachments?: TicketAttachment[] }) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    ticketId: plain.ticketId,
    senderId: plain.senderId,
    senderRole: plain.senderRole,
    senderName: plain.sender?.name ?? null,
    body: plain.body,
    createdAt: plain.createdAt,
    attachments: Array.isArray(plain.attachments)
      ? plain.attachments.map((a: TicketAttachment) => serializeAttachment(a))
      : [],
  };
}

function serializeTicket(
  row: SupportTicket,
  extras: {
    latestMessagePreview?: string | null;
    messages?: ReturnType<typeof serializeMessage>[];
    attachments?: ReturnType<typeof serializeAttachment>[];
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
    messages: extras.messages,
    attachments: extras.attachments,
  };
}

async function loadLatestMessagePreviews(
  ticketIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ticketIds.length === 0) return map;

  const rows = await sequelize.query<{ ticketId: string; body: string }>(
    `SELECT DISTINCT ON ("ticketId") "ticketId", body
     FROM ticket_messages
     WHERE "ticketId" IN (:ticketIds) AND "deletedAt" IS NULL
     ORDER BY "ticketId", "createdAt" DESC, id DESC`,
    {
      replacements: { ticketIds },
      type: QueryTypes.SELECT,
    },
  );

  for (const row of rows) {
    map.set(row.ticketId, row.body.slice(0, 160));
  }
  return map;
}

async function findTicketManagerUserIds(limit = 50): Promise<string[]> {
  const assignees = await usersService.findAssigneesByPermission(
    PERMISSIONS.TICKET_MANAGE,
    limit,
  );
  return assignees.map((u) => u.id);
}

async function assertTicketAccess(ticket: SupportTicket, actor: Actor): Promise<void> {
  if (isAdminActor(actor)) return;
  if (ticket.customerId === actor.id) return;
  if (isVendorActor(actor) && ticket.relatedVendorId && ticket.relatedVendorId === actor.vendorId) {
    return;
  }
  throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
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
        }
      } else {
        relatedOrderId = null;
      }

      const assignedToId = relatedVendorId
        ? await findVendorOwnerUserId(relatedVendorId)
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
        await TicketAttachment.bulkCreate(
          attachments.map((a) => ({
            ticketId: ticket.id,
            messageId: message.id,
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
        action: 'SUPPORT_TICKET_CREATED',
        entityType: 'SupportTicket',
        entityId: ticket.id,
        metadata: { ticketNumber, status: ticket.status },
      });

      const notifyIds = new Set<string>();
      if (ticket.relatedVendorId) {
        const ownerId = await findVendorOwnerUserId(ticket.relatedVendorId);
        if (ownerId) notifyIds.add(ownerId);
      } else {
        for (const id of await findTicketManagerUserIds()) notifyIds.add(id);
      }

      for (const userId of notifyIds) {
        void notificationsService.sendTicketCreated(userId, ticket.id, {
          ticketNumber,
          subject: ticket.subject,
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
  ) {
    const cursor = decodeCursor(query.cursor);
    const keysetWhere = buildKeysetWhere(cursor, query.direction);
    const rows = await SupportTicket.findAll({
      where: keysetWhere ? { [Op.and]: [where, keysetWhere] } : where,
      include: ticketListInclude,
      order: keysetOrder(query.direction),
      limit: query.limit + 1,
    });
    const page = buildKeysetPage(rows, query.limit);
    const previews = await loadLatestMessagePreviews(page.items.map((t) => t.id));
    return {
      items: page.items.map((row) =>
        serializeTicket(row, { latestMessagePreview: previews.get(row.id) ?? null }),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listMine(actor: Actor, query: KeysetQuery) {
    return this.listWithKeyset({ customerId: actor.id }, query);
  }

  async listVendor(actor: Actor, query: VendorTicketListQuery) {
    if (!isVendorActor(actor)) {
      throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
    }
    const where: WhereOptions = { relatedVendorId: actor.vendorId };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.category) where.category = query.category;
    return this.listWithKeyset(where, query);
  }

  async listAdmin(query: AdminTicketListQuery) {
    const where: WhereOptions = {};
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.category) where.category = query.category;
    if (query.vendorId) where.relatedVendorId = query.vendorId;
    return this.listWithKeyset(where, query);
  }

  async getById(id: string, actor: Actor, messageLimit = 20) {
    const ticket = await getTicketOrThrow(id);
    await assertTicketAccess(ticket, actor);

    const messages = await TicketMessage.findAll({
      where: { ticketId: id },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name'], required: false },
        { model: TicketAttachment, as: 'attachments', required: false },
      ],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: messageLimit + 1,
    });
    const messagePage = buildKeysetPage(messages, messageLimit);
    const attachments = await TicketAttachment.findAll({
      where: { ticketId: id },
      order: [['createdAt', 'ASC']],
    });

    return {
      ...serializeTicket(ticket, {
        messages: messagePage.items.map((m) =>
          serializeMessage(m as TicketMessage & { sender?: User; attachments?: TicketAttachment[] }),
        ),
        attachments: attachments.map(serializeAttachment),
      }),
      messagesNextCursor: messagePage.nextCursor,
    };
  }

  async listMessages(id: string, actor: Actor, query: KeysetQuery) {
    const ticket = await getTicketOrThrow(id);
    await assertTicketAccess(ticket, actor);

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
      items: page.items.map((m) =>
        serializeMessage(m as TicketMessage & { sender?: User; attachments?: TicketAttachment[] }),
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
        await TicketAttachment.bulkCreate(
          attachments.map((a) => ({
            ticketId: id,
            messageId: message.id,
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
      });

      const notifyIds = new Set<string>();
      if (actor.id !== locked.customerId) notifyIds.add(locked.customerId);
      if (locked.assignedToId && locked.assignedToId !== actor.id) {
        notifyIds.add(locked.assignedToId);
      } else if (locked.relatedVendorId) {
        const ownerId = await findVendorOwnerUserId(locked.relatedVendorId);
        if (ownerId && ownerId !== actor.id) notifyIds.add(ownerId);
      } else if (senderRole === TICKET_SENDER_ROLE.CUSTOMER) {
        for (const adminId of await findTicketManagerUserIds()) {
          if (adminId !== actor.id) notifyIds.add(adminId);
        }
      }

      for (const userId of notifyIds) {
        void notificationsService.sendTicketReplied(userId, id, {
          ticketNumber: locked.ticketNumber,
          subject: locked.subject,
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

      if (isAdminActor(actor)) {
        // ok
      } else if (
        isVendorActor(actor) &&
        locked.relatedVendorId &&
        locked.relatedVendorId === actor.vendorId
      ) {
        // ok
      } else {
        throw new AppError(ERROR_MESSAGES.TICKET_FORBIDDEN, 403, ERROR_CODES.TICKET_FORBIDDEN);
      }

      assertTransition(locked.status, SUPPORT_TICKET_STATUS.RESOLVED);
      const now = new Date();
      await locked.update(
        {
          status: SUPPORT_TICKET_STATUS.RESOLVED,
          resolvedAt: now,
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
      });

      void notificationsService.sendTicketResolved(locked.customerId, id, {
        ticketNumber: locked.ticketNumber,
        subject: locked.subject,
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
      });

      const notifyIds = new Set<string>();
      if (locked.assignedToId) notifyIds.add(locked.assignedToId);
      else if (locked.relatedVendorId) {
        const ownerId = await findVendorOwnerUserId(locked.relatedVendorId);
        if (ownerId) notifyIds.add(ownerId);
      } else {
        for (const adminId of await findTicketManagerUserIds()) notifyIds.add(adminId);
      }

      for (const userId of notifyIds) {
        void notificationsService.sendTicketReopened(userId, id, {
          ticketNumber: locked.ticketNumber,
          subject: locked.subject,
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

      await usersService.assertAssignableUser(
        assignedToId,
        PERMISSIONS.TICKET_MANAGE,
        t,
      );

      await locked.update(
        { assignedToId, updatedBy: actor.id },
        { transaction: t },
      );

      await logAudit({
        actorId: actor.id,
        action: 'SUPPORT_TICKET_REASSIGNED',
        entityType: 'SupportTicket',
        entityId: id,
        metadata: { assignedToId },
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
      if (locked.status !== SUPPORT_TICKET_STATUS.RESOLVED) {
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

    let count = 0;
    for (const ticket of due) {
      await sequelize.transaction(async (t) => {
        const locked = await SupportTicket.findByPk(ticket.id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!locked || locked.status !== SUPPORT_TICKET_STATUS.RESOLVED) return;
        assertTransition(locked.status, SUPPORT_TICKET_STATUS.CLOSED);
        await locked.update(
          {
            status: SUPPORT_TICKET_STATUS.CLOSED,
            closedAt: new Date(),
            updatedBy: null,
          },
          { transaction: t },
        );
        await logAudit({
          actorId: locked.customerId,
          action: 'SUPPORT_TICKET_AUTO_CLOSED',
          entityType: 'SupportTicket',
          entityId: locked.id,
          metadata: {
            from: SUPPORT_TICKET_STATUS.RESOLVED,
            to: SUPPORT_TICKET_STATUS.CLOSED,
          },
        });
      });
      count += 1;
    }
    return count;
  }
}

export const supportTicketsService = new SupportTicketsService();
