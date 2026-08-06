import { ROLES } from '@core/constants/statuses';

type RoleCarrier = {
  role?: { name?: string } | null;
  Role?: { name?: string } | null;
};

/** Sequelize may attach the association as `role` or `Role` depending on `as`. */
export function roleNameOf(user: RoleCarrier | null | undefined, fallback = ROLES.CUSTOMER): string {
  return user?.role?.name ?? user?.Role?.name ?? fallback;
}
