import { notificationsService } from '@modules/notifications/notifications.service';
import { ticketPortalUrlForGroup } from '@modules/notifications/portalLinks';

/** Confirmation to the shopper that their ticket arrived (staff already got their own email). */
export function notifyTicketReceived(userId: string, ticket: { id: string; ticketNumber?: string; subject?: string }): void {
  void notificationsService.sendTicketCreated(userId, ticket.id, {
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    actionUrl: ticketPortalUrlForGroup(ticket.id, 'customer'),
    portalGroup: 'customer',
  });
}
