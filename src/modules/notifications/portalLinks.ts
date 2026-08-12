import { env } from '@config/env';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { ADMIN_ROLES, VENDOR_ROLES, BUG_REPORTER_ROLE } from '@core/constants/statuses';
import { roleNameOf } from '@utils/userRole';

type PortalGroup = 'customer' | 'vendor' | 'admin';

function clientBase(): string {
  return env.CLIENT_URL.replace(/\/$/, '');
}

function groupForRoleName(roleName: string): PortalGroup {
  if ((ADMIN_ROLES as readonly string[]).includes(roleName)) return 'admin';
  if ((VENDOR_ROLES as readonly string[]).includes(roleName)) return 'vendor';
  return 'customer';
}

/** Reporter-facing bug report URL — vendor dashboard for vendor reporters, support portal otherwise. */
export function bugReportPortalUrl(bugReportId: string, reporterRole: string): string {
  const base = clientBase();
  if (
    reporterRole === BUG_REPORTER_ROLE.VENDOR ||
    reporterRole === BUG_REPORTER_ROLE.VENDOR_STAFF
  ) {
    return `${base}/vendor/dashboard/bug-reports/${bugReportId}`;
  }
  return `${base}/support/bug-reports/${bugReportId}`;
}

/** Ticket URL for a known recipient group. */
export function ticketPortalUrlForGroup(ticketId: string, group: PortalGroup): string {
  const base = clientBase();
  if (group === 'admin') return `${base}/admin/support-tickets/${ticketId}`;
  if (group === 'vendor') return `${base}/vendor/dashboard/support-tickets/${ticketId}`;
  return `${base}/support/tickets/${ticketId}`;
}

/** Resolves a recipient's role from the DB, then builds the correct ticket portal URL. */
export async function ticketPortalUrlForUser(ticketId: string, userId: string): Promise<string> {
  const group = await ticketPortalGroupForUser(userId);
  return ticketPortalUrlForGroup(ticketId, group);
}

/** Portal group for a user id (customer / vendor / admin). */
export async function ticketPortalGroupForUser(userId: string): Promise<PortalGroup> {
  const user = await User.findByPk(userId, { include: [{ model: Role, as: 'role' }] });
  return groupForRoleName(roleNameOf(user as any));
}
