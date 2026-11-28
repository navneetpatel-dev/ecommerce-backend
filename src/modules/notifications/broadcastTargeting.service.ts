import { Op, fn, col, literal } from 'sequelize';
import { Address } from '@database/models/address.model';
import { Cart } from '@database/models/cart.model';
import { Order } from '@database/models/order.model';
import { PushSubscription } from '@database/models/pushSubscription.model';
import { Role } from '@database/models/role.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';
import { VendorCategory } from '@database/models/vendorCategory.model';
import type { BroadcastChannel, BroadcastClassification } from '@database/models/adminBroadcast.model';
import type { BroadcastTargetConfig, ResolvedRecipient, UserActivityFilter } from './broadcastTargeting.types';
import { hasBroadcastTarget } from './broadcastTarget';

export type { BroadcastTargetConfig, ResolvedRecipient, UserActivityFilter } from './broadcastTargeting.types';

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

interface QueryParts {
  empty: boolean;
  where: Record<string | symbol, unknown>;
  roleWhere: Record<string | symbol, unknown>;
  vendorWhere: Record<string | symbol, unknown>;
  requireVendor: boolean;
}

async function buildUserQueryParts(config: BroadcastTargetConfig): Promise<QueryParts> {
  const roles = config.roles?.length ? config.roles : config.role ? [config.role] : [];
  const where: Record<string | symbol, unknown> = {};
  const excludeIds = [...new Set(config.excludeUserIds ?? [])];
  if (!hasBroadcastTarget(config)) return { empty: true, where, roleWhere: {}, vendorWhere: {}, requireVendor: false };

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
      if (act.include.length === 0) return { empty: true, where, roleWhere: {}, vendorWhere: {}, requireVendor: false };
      where.id = { [Op.in]: act.include };
    }
    if (act.exclude) excludeIds.push(...act.exclude);
  }

  if (config.userSegment?.state || config.userSegment?.city) {
    const addrWhere: Record<string, unknown> = {};
    if (config.userSegment.state) addrWhere.state = { [Op.iLike]: `%${config.userSegment.state.trim()}%` };
    if (config.userSegment.city) addrWhere.city = { [Op.iLike]: `%${config.userSegment.city.trim()}%` };
    const addrs = await Address.findAll({ where: addrWhere, attributes: ['userId'], raw: true });
    const addrUserIds = [...new Set(addrs.map((a) => a.userId))];
    if (addrUserIds.length === 0) return { empty: true, where, roleWhere: {}, vendorWhere: {}, requireVendor: false };
    where.id = where.id ? { [Op.and]: [where.id, { [Op.in]: addrUserIds }] } : { [Op.in]: addrUserIds };
  }

  if (config.emails?.length) {
    where.email = { [Op.in]: config.emails.map((e) => e.trim().toLowerCase()) };
  }
  if (config.userIds?.length) {
    where.id = where.id ? { [Op.and]: [where.id, { [Op.in]: config.userIds }] } : { [Op.in]: config.userIds };
  }
  if (excludeIds.length) {
    where.id = where.id ? { [Op.and]: [where.id, { [Op.notIn]: excludeIds }] } : { [Op.notIn]: excludeIds };
  }

  const roleWhere: Record<string | symbol, unknown> = {};
  if (!config.allUsers && roles.length > 0) {
    roleWhere.name = { [Op.in]: roles };
  }
  if (config.excludeRoles?.length) {
    roleWhere.name = roleWhere.name
      ? { [Op.and]: [roleWhere.name, { [Op.notIn]: config.excludeRoles }] }
      : { [Op.notIn]: config.excludeRoles };
  }

  const vendorWhere: Record<string | symbol, unknown> = {};
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
    if (vIds.length === 0) return { empty: true, where, roleWhere, vendorWhere, requireVendor };
    vendorWhere.id = { [Op.in]: vIds };
    requireVendor = true;
  }

  return { empty: false, where, roleWhere, vendorWhere, requireVendor };
}

export async function resolveBroadcastBatch(
  config: BroadcastTargetConfig,
  opts: { afterId?: string; limit?: number } = {},
): Promise<ResolvedRecipient[]> {
  const parts = await buildUserQueryParts(config);
  if (parts.empty) return [];

  const batchWhere = opts.afterId
    ? { [Op.and]: [parts.where, { id: { [Op.gt]: opts.afterId } }] }
    : parts.where;

  const users = await User.findAll({
    where: batchWhere as Record<string, unknown>,
    attributes: ['id', 'email', 'name', 'emailVerified', 'emailMarketingConsent', 'emailSuppressed'],
    include: [
      { model: Role, as: 'role', attributes: ['name'], where: Object.keys(parts.roleWhere).length ? parts.roleWhere : undefined, required: true },
      { model: Vendor, as: 'vendor', attributes: ['businessName', 'city'], where: Object.keys(parts.vendorWhere).length ? parts.vendorWhere : undefined, required: parts.requireVendor },
    ],
    order: [['id', 'ASC']],
    limit: opts.limit ?? 200,
    raw: true,
    nest: true,
  }) as unknown as Array<{
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    emailMarketingConsent: boolean;
    emailSuppressed: boolean;
    role?: { name?: string };
    vendor?: { businessName?: string; city?: string };
  }>;

  const userIds = users.map((u) => u.id);
  const pushRows = userIds.length
    ? await PushSubscription.findAll({ where: { userId: { [Op.in]: userIds } }, attributes: ['userId'], raw: true })
    : [];
  const pushSet = new Set(pushRows.map((p) => p.userId));

  return users.map((u) => ({
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

export async function previewBroadcastTargetsQuery(
  config: BroadcastTargetConfig,
  opts: { classification?: BroadcastClassification; channels?: BroadcastChannel[]; page?: number; limit?: number } = {},
) {
  const parts = await buildUserQueryParts(config);
  const page = Math.max(opts.page ?? 1, 1);
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  if (parts.empty) {
    return { total: 0, emailEligible: 0, pushEligible: 0, inAppEligible: 0, sampleRecipients: [], sampleHasMore: false };
  }

  const classification = opts.classification ?? 'operational';
  const include = [
    { model: Role, as: 'role', attributes: ['name'], where: Object.keys(parts.roleWhere).length ? parts.roleWhere : undefined, required: true },
    { model: Vendor, as: 'vendor', attributes: ['businessName'], where: Object.keys(parts.vendorWhere).length ? parts.vendorWhere : undefined, required: parts.requireVendor },
  ];

  const [allMatched, sampleRows] = await Promise.all([
    User.findAll({
      where: parts.where as Record<string, unknown>,
      attributes: ['id', 'emailMarketingConsent', 'emailSuppressed'],
      include,
      raw: true,
    }) as unknown as Array<{ id: string; emailMarketingConsent: boolean; emailSuppressed: boolean }>,
    User.findAll({
      where: parts.where as Record<string, unknown>,
      attributes: ['id', 'name', 'email'],
      include,
      order: [['createdAt', 'DESC'], ['id', 'ASC']],
      offset: (page - 1) * limit,
      limit: limit + 1,
      raw: true,
      nest: true,
    }) as unknown as Array<{ id: string; name: string; email: string; role?: { name?: string }; vendor?: { businessName?: string } }>,
  ]);

  const ids = allMatched.map((u) => u.id);
  const pushCount = ids.length
    ? await PushSubscription.count({ where: { userId: { [Op.in]: ids } }, distinct: true, col: 'userId' })
    : 0;
  const emailEligible = allMatched.filter(
    (r) => !r.emailSuppressed && (classification !== 'marketing' || r.emailMarketingConsent),
  ).length;

  const sampleHasMore = sampleRows.length > limit;
  const sampleRecipients = sampleRows.slice(0, limit).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role?.name ?? 'CUSTOMER',
    businessName: u.vendor?.businessName ?? null,
  }));

  return {
    total: allMatched.length,
    emailEligible,
    pushEligible: pushCount,
    inAppEligible: allMatched.length,
    sampleRecipients,
    sampleHasMore,
  };
}
