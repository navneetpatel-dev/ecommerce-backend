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

/**
 * Where an email's button leads when the caller passes no link. Every path here is
 * a real web page (a test checks them against the web routes): the customer order
 * page is /orders/:id, the seller home is /vendor/dashboard/overview.
 */
export function customerOrderUrl(orderId: string): string {
  const base = clientBase();
  return orderId ? `${base}/orders/${encodeURIComponent(orderId)}` : `${base}/orders`;
}

const VENDOR_PAGE_BY_TYPE: Record<string, string> = {
  VENDOR_NEW_ORDER: 'orders',
  LOW_STOCK_ALERT: 'products',
  PRODUCT_APPROVED: 'products',
  PRODUCT_REJECTED: 'products',
  PAYOUT_PROCESSED: 'payouts',
  PAYOUT_PAID: 'payouts',
  PAYOUT_FAILED: 'payouts',
  COUPON_USAGE_LIMIT: 'coupons',
  COUPON_EXPIRING: 'coupons',
};

export function vendorDashboardUrl(notificationType: string): string {
  return `${clientBase()}/vendor/dashboard/${VENDOR_PAGE_BY_TYPE[notificationType] ?? 'overview'}`;
}

export function walletUrl(): string {
  return `${clientBase()}/wallet`;
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
