import { Op, fn, col, literal } from 'sequelize';
import type { RoleName } from '@core/constants/statuses';
import { Address } from '@database/models/address.model';
import { Cart } from '@database/models/cart.model';
import { Order } from '@database/models/order.model';
import { PushSubscription } from '@database/models/pushSubscription.model';
import { Role } from '@database/models/role.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { VendorCategory } from '@database/models/vendorCategory.model';
import type { BroadcastChannel, BroadcastClassification } from '@database/models/adminBroadcast.model';

export type UserActivityFilter =
  | 'ordered_last_30d'
  | 'inactive_30d'
  | 'inactive_90d'
  | 'repeat_buyers'
  | 'abandoned_cart';

export interface BroadcastTargetConfig {
  mode?: 'roles' | 'users' | 'user_segment' | 'vendor_segment';
  allUsers?: boolean;
  role?: RoleName;
  roles?: RoleName[];
  userIds?: string[];
  emails?: string[];
  userSegment?: {
    status?: 'ACTIVE' | 'BLOCKED' | 'ALL';
    emailVerified?: boolean;
    emailMarketingConsent?: boolean;
    signedUpWithinDays?: number;
    activity?: UserActivityFilter;
    state?: string;
    city?: string;
  };
  vendorSegment?: {
    vendorStatus?: 'APPROVED' | 'PENDING' | 'SUSPENDED';
    kycVerified?: boolean;
    categoryIds?: string[];
    state?: string;
    minPerformanceScore?: number;
    maxPerformanceScore?: number;
  };
  excludeUserIds?: string[];
  excludeRoles?: RoleName[];
}

export interface ResolvedRecipient {
  id: string;
  email: string;
  name: string;
  role: string;
  businessName: string | null;
  city: string | null;
  emailVerified: boolean;
  emailMarketingConsent: boolean;
  emailSuppressed: boolean;
  hasPush: boolean;
}

export function interpolateBroadcastText(text: string, recipient: ResolvedRecipient): string {
  const firstName = recipient.name.trim().split(/\s+/)[0] || 'there';
  const map: Record<string, string> = {
    firstName,
    fullName: recipient.name || firstName,
    email: recipient.email,
    role: recipient.role,
    businessName: recipient.businessName ?? '',
    city: recipient.city ?? '',
  };
  return text.replace(/\{\{(firstName|fullName|email|role|businessName|city)\}\}/g, (_, k) => map[k] ?? '');
}

async function resolveActivityUserIds(activity: UserActivityFilter): Promise<{ include?: string[]; exclude?: string[] }> {
  const now = Date.now();
  if (activity === 'abandoned_cart') {
    const carts = await Cart.findAll({ where: { userId: { [Op.ne]: null } }, attributes: ['userId'], raw: true });
    return { include: [...new Set(carts.map((c) => c.userId).filter(Boolean) as string[])] };
  }
  if (activity === 'ordered_last_30d') {
    const cutoff = new Date(now - 30 * 86400_000);
    const orders = await Order.findAll({ where: { createdAt: { [Op.gte]: cutoff } }, attributes: ['userId'], raw: true });
    return { include: [...new Set(orders.map((o) => o.userId).filter(Boolean))] };
  }
  if (activity === 'inactive_30d' || activity === 'inactive_90d') {
    const days = activity === 'inactive_30d' ? 30 : 90;
    const cutoff = new Date(now - days * 86400_000);
    const orders = await Order.findAll({ where: { createdAt: { [Op.gte]: cutoff } }, attributes: ['userId'], raw: true });
    return { exclude: [...new Set(orders.map((o) => o.userId).filter(Boolean))] };
  }
  if (activity === 'repeat_buyers') {
    const rows = (await Order.findAll({
      attributes: ['userId', [fn('COUNT', col('id')), 'orderCount']],
      group: ['userId'],
      having: literal('COUNT("id") >= 2'),
      raw: true,
    })) as unknown as Array<{ userId: string }>;
    return { include: rows.map((r) => r.userId).filter(Boolean) };
  }
  return {};
}

export async function resolveBroadcastRecipients(
  config: BroadcastTargetConfig,
  _opts: { classification?: BroadcastClassification; channels?: BroadcastChannel[] } = {},
): Promise<ResolvedRecipient[]> {
  const roles = config.roles?.length ? config.roles : config.role ? [config.role] : [];
  const where: Record<string, unknown> = {};
  const includeIds: Set<string> | null = config.userIds?.length ? new Set(config.userIds) : null;
  const excludeIds = new Set(config.excludeUserIds ?? []);

  if (config.userSegment?.status && config.userSegment.status !== 'ALL') {
    where.status = config.userSegment.status;
  } else if (!config.userSegment?.status) {
    where.status = 'ACTIVE';
  }
  if (typeof config.userSegment?.emailVerified === 'boolean') {
    where.emailVerified = config.userSegment.emailVerified;
  }
  if (typeof config.userSegment?.emailMarketingConsent === 'boolean') {
    where.emailMarketingConsent = config.userSegment.emailMarketingConsent;
  }
  if (config.userSegment?.signedUpWithinDays) {
    where.createdAt = { [Op.gte]: new Date(Date.now() - config.userSegment.signedUpWithinDays * 86400_000) };
  }

  if (config.userSegment?.activity) {
    const act = await resolveActivityUserIds(config.userSegment.activity);
    if (act.include) {
      if (act.include.length === 0) return [];
      where.id = { [Op.in]: act.include };
    }
    if (act.exclude) act.exclude.forEach((id) => excludeIds.add(id));
  }

  if (config.userSegment?.state || config.userSegment?.city) {
    const addrWhere: Record<string, unknown> = {};
    if (config.userSegment.state) addrWhere.state = { [Op.iLike]: `%${config.userSegment.state.trim()}%` };
    if (config.userSegment.city) addrWhere.city = { [Op.iLike]: `%${config.userSegment.city.trim()}%` };
    const addrs = await Address.findAll({ where: addrWhere, attributes: ['userId'], raw: true });
    const addrUserIds = [...new Set(addrs.map((a) => a.userId))];
    if (addrUserIds.length === 0) return [];
    where.id = where.id ? { [Op.and]: [where.id, { [Op.in]: addrUserIds }] } : { [Op.in]: addrUserIds };
  }

  if (config.emails?.length) {
    where.email = { [Op.in]: config.emails.map((e) => e.trim().toLowerCase()) };
  }
  if (includeIds) {
    const arr = [...includeIds];
    where.id = where.id ? { [Op.and]: [where.id, { [Op.in]: arr }] } : { [Op.in]: arr };
  }

  const roleWhere: Record<string, unknown> = {};
  if (!config.allUsers && roles.length > 0) {
    roleWhere.name = { [Op.in]: roles };
  }
  if (config.excludeRoles?.length) {
    roleWhere.name = roleWhere.name
      ? { [Op.and]: [roleWhere.name, { [Op.notIn]: config.excludeRoles }] }
      : { [Op.notIn]: config.excludeRoles };
  }

  const vendorWhere: Record<string, unknown> = {};
  let requireVendor = config.mode === 'vendor_segment';
  if (config.vendorSegment?.vendorStatus) {
    vendorWhere.status = config.vendorSegment.vendorStatus;
    requireVendor = true;
  }
  if (typeof config.vendorSegment?.kycVerified === 'boolean') {
    vendorWhere.kycVerified = config.vendorSegment.kycVerified;
    requireVendor = true;
  }
  if (config.vendorSegment?.state) {
    vendorWhere.state = { [Op.iLike]: `%${config.vendorSegment.state.trim()}%` };
    requireVendor = true;
  }
  if (config.vendorSegment?.minPerformanceScore != null || config.vendorSegment?.maxPerformanceScore != null) {
    const scoreRange: Record<symbol, number> = {};
    if (config.vendorSegment.minPerformanceScore != null) scoreRange[Op.gte] = config.vendorSegment.minPerformanceScore;
    if (config.vendorSegment.maxPerformanceScore != null) scoreRange[Op.lte] = config.vendorSegment.maxPerformanceScore;
    vendorWhere.performanceScore = scoreRange;
    requireVendor = true;
  }
  if (config.vendorSegment?.categoryIds?.length) {
    const vcs = await VendorCategory.findAll({
      where: { categoryId: { [Op.in]: config.vendorSegment.categoryIds } },
      attributes: ['vendorId'],
      raw: true,
    });
    const vIds = [...new Set(vcs.map((vc) => vc.vendorId))];
    if (vIds.length === 0) return [];
    vendorWhere.id = { [Op.in]: vIds };
    requireVendor = true;
  }

  const users = await User.findAll({
    where,
    attributes: ['id', 'email', 'name', 'emailVerified', 'emailMarketingConsent', 'emailSuppressed'],
    include: [
      { model: Role, as: 'role', attributes: ['name'], where: Object.keys(roleWhere).length ? roleWhere : undefined, required: true },
      { model: Vendor, as: 'vendor', attributes: ['businessName', 'city'], where: Object.keys(vendorWhere).length ? vendorWhere : undefined, required: requireVendor },
    ],
  });

  const filtered = users.filter((u) => !excludeIds.has(u.id));
  const userIds = filtered.map((u) => u.id);
  const pushRows = userIds.length
    ? await PushSubscription.findAll({ where: { userId: { [Op.in]: userIds } }, attributes: ['userId'], raw: true })
    : [];
  const pushSet = new Set(pushRows.map((p) => p.userId));

  return filtered.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role?.name ?? 'CUSTOMER',
    businessName: u.vendor?.businessName ?? null,
    city: u.vendor?.city ?? null,
    emailVerified: Boolean(u.emailVerified),
    emailMarketingConsent: Boolean(u.emailMarketingConsent),
    emailSuppressed: Boolean(u.emailSuppressed),
    hasPush: pushSet.has(u.id),
  }));
}
