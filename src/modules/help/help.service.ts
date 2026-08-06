import { HelpTicket } from '@database/models/helpTicket.model';
import { logger } from '@core/logger';
import type { CreateHelpTicketRequest } from './help.dto';

type SerializedTicket = {
  id: string;
  topic: HelpTicket['topic'];
  subject: string;
  status: HelpTicket['status'];
  createdAt: Date;
};

function serializeTicket(ticket: HelpTicket): SerializedTicket {
  const plain = typeof ticket.get === 'function' ? ticket.get({ plain: true }) : ticket;
  return {
    id: plain.id,
    topic: plain.topic,
    subject: plain.subject,
    status: plain.status,
    createdAt: plain.createdAt,
  };
}

export class HelpService {
  async createTicket(
    data: CreateHelpTicketRequest,
    userId?: string | null,
  ): Promise<SerializedTicket> {
    const ticket = await HelpTicket.create({
      userId: userId ?? null,
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      topic: data.topic,
      subject: data.subject.trim(),
      message: data.message.trim(),
      orderId: data.orderId ?? null,
      status: 'OPEN',
      createdBy: userId ?? null,
      updatedBy: null,
      deletedBy: null,
    });

    logger.info('Help ticket created', {
      ticketId: ticket.id,
      topic: ticket.topic,
      email: ticket.email,
      userId: userId ?? null,
    });

    return serializeTicket(ticket);
  }

  async listTicketsForUser(userId: string): Promise<SerializedTicket[]> {
    const rows = await HelpTicket.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    return rows.map(serializeTicket);
  }
}

export const helpService = new HelpService();
