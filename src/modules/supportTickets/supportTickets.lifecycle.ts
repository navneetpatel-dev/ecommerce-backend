import { SUPPORT_TICKET_STATUS, type SupportTicketStatus } from '@core/constants/statuses';

/** Canonical ticket status transitions — imported by service + tests (single source of truth). */
export const TICKET_ALLOWED_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
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

export function canTransitionTicketStatus(
  from: SupportTicketStatus,
  to: SupportTicketStatus,
): boolean {
  return (TICKET_ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}
