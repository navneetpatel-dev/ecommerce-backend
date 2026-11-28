/** The searchable lists the broadcast composer picks its audience from. */
import { Op, fn, col } from 'sequelize';
import { CATEGORY_STATUS } from '@core/constants/statuses';
import { Address } from '@database/models/address.model';
import { Category } from '@database/models/category.model';
import { Role } from '@database/models/role.model';
import { User } from '@database/models/user.model';
import { Vendor } from '@database/models/vendor.model';

export async function searchTargetUsers(
  q: string,
  page = 1,
  limit = 20,
): Promise<{
  items: Array<{ id: string; name: string; email: string; role: string }>;
  total: number;
  page: number;
  hasMore: boolean;
}> {
  const safePage = Math.max(page, 1);
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const trimmed = q.trim();
  const where: Record<string | symbol, unknown> = { status: 'ACTIVE' };
  if (trimmed) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${trimmed}%` } },
      { email: { [Op.iLike]: `%${trimmed}%` } },
    ];
  }
  const { count, rows } = await User.findAndCountAll({
    where: where as Record<string, unknown>,
    attributes: ['id', 'name', 'email'],
    include: [{ model: Role, as: 'role', attributes: ['name'] }],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    order: [['createdAt', 'DESC'], ['id', 'ASC']],
  });
  return {
    items: rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role?.name ?? 'CUSTOMER',
    })),
    total: count,
    page: safePage,
    hasMore: safePage * safeLimit < count,
  };
}

export async function searchCategories(
  q: string,
  page = 1,
  limit = 20,
): Promise<{
  items: Array<{ id: string; name: string; slug: string }>;
  total: number;
  page: number;
  hasMore: boolean;
}> {
  const safePage = Math.max(page, 1);
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const trimmed = q.trim();
  const where: Record<string, unknown> = { status: CATEGORY_STATUS.ACTIVE };
  if (trimmed) where.name = { [Op.iLike]: `%${trimmed}%` };
  const { count, rows } = await Category.findAndCountAll({
    where,
    attributes: ['id', 'name', 'slug'],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    order: [['name', 'ASC']],
  });
  return {
    items: rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    total: count,
    page: safePage,
    hasMore: safePage * safeLimit < count,
  };
}

export async function searchLocations(field: 'state' | 'city', q: string, page = 1, limit = 20) {
  const safePage = Math.max(page, 1);
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  const trimmed = q.trim();
  const locWhere = trimmed
    ? { [field]: { [Op.and]: [{ [Op.ne]: null }, { [Op.iLike]: `%${trimmed}%` }] } }
    : { [field]: { [Op.ne]: null } };

  const [addrRows, vendorRows] = await Promise.all([
    Address.findAll({ where: locWhere, attributes: [[fn('DISTINCT', col(field)), field]], raw: true }),
    Vendor.findAll({ where: locWhere, attributes: [[fn('DISTINCT', col(field)), field]], raw: true }),
  ]);

  const merged = [
    ...new Set(
      [...addrRows, ...vendorRows]
        .map((r) => String((r as unknown as Record<string, unknown>)[field] ?? '').trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const start = (safePage - 1) * safeLimit;
  return {
    items: merged.slice(start, start + safeLimit),
    total: merged.length,
    page: safePage,
    hasMore: start + safeLimit < merged.length,
  };
}
