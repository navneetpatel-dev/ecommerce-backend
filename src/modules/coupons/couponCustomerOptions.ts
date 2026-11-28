import { z } from 'zod';
import { Role } from '@database/models/role.model';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { ROLES, USER_STATUS } from '@core/constants/statuses';
import { usersRepository } from '@modules/users/users.repository';

export const CouponCustomerOptionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  search: z.string().trim().max(100).optional(),
});

export type CouponCustomerOptionsQuery = z.infer<typeof CouponCustomerOptionsQuerySchema>;

export type CouponCustomerOption = { id: string; name: string | null; email: string };

/**
 * Customers a coupon can be limited to, for the "specific customers" picker. Anyone who
 * manages coupons may search them; only id, name and email go out, never a full profile,
 * so the picker doesn't need user-management access.
 */
export async function listCouponCustomerOptions(
  query: CouponCustomerOptionsQuery,
): Promise<{ users: CouponCustomerOption[]; pagination: ReturnType<typeof buildPaginationMeta> }> {
  const role = await Role.findOne({ where: { name: ROLES.CUSTOMER }, attributes: ['id'] });
  if (!role) return { users: [], pagination: buildPaginationMeta(0, query.page, query.limit) };
  const { rows, count } = await usersRepository.findWithFilters({
    roleId: role.id,
    status: USER_STATUS.ACTIVE,
    search: query.search || undefined,
    limit: query.limit,
    offset: paginationOffset(query.page, query.limit),
  });
  return {
    users: rows.map((user) => ({ id: String(user.id), name: user.name ?? null, email: String(user.email) })),
    pagination: buildPaginationMeta(count, query.page, query.limit),
  };
}
