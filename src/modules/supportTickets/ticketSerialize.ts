/** How tickets, their messages and attachments are sent to clients. */
import type { SupportTicket } from '@database/models/supportTicket.model';
import type { TicketMessage } from '@database/models/ticketMessage.model';
import type { TicketAttachment } from '@database/models/ticketAttachment.model';
import type { User } from '@database/models/user.model';
import { toPlain } from '@core/repository/toPlain';
import { extractS3KeyFromUrl, signedGetObjectUrlMap } from '@config/s3';

type PlainAttachment = {
  id: string;
  ticketId: string;
  messageId?: string | null;
  url: string;
  type: string;
  durationSeconds?: number | null;
  createdAt: Date;
};

type PlainMessage = {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: string;
  sender?: { name?: string } | null;
  body: string;
  createdAt: Date;
  attachments?: TicketAttachment[];
};

type PlainTicket = {
  id: string;
  ticketNumber: string;
  customerId: string;
  customer?: { name?: string } | null;
  subject: string;
  description: string;
  category: string;
  relatedOrderId?: string | null;
  relatedVendorId?: string | null;
  relatedVendor?: { businessName?: string } | null;
  priority: string;
  status: string;
  assignedToId?: string | null;
  assignedTo?: { name?: string } | null;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  customerSatisfactionRating?: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function serializeAttachments(rows: TicketAttachment[]) {
  const plains = rows.map((row) => toPlain<PlainAttachment>(row));
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

export type SerializedAttachment = Awaited<ReturnType<typeof serializeAttachments>>[number];

export async function serializeMessages(
  rows: Array<TicketMessage & { sender?: User; attachments?: TicketAttachment[] }>,
) {
  const plains = rows.map((row) => toPlain<PlainMessage>(row));
  const allAttachments = plains.flatMap((plain) =>
    Array.isArray(plain.attachments) ? plain.attachments : [],
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
      ? plain.attachments.map((row) => byId.get(toPlain<PlainAttachment>(row).id)).filter(Boolean)
      : [],
  }));
}

export type SerializedMessage = Awaited<ReturnType<typeof serializeMessages>>[number];

export function serializeTicket(
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
  const plain = toPlain<PlainTicket>(row);
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
