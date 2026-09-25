import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import {
  cascadeDeleteEntityMedia,
  deleteS3ObjectIfReplaced,
  S3_ENTITY_TYPES,
} from '@core/s3';
import { usersRepository } from './users.repository';
import { addressesRepository } from './addresses.repository';
import { authRepository } from '../auth/auth.repository';
import { Role } from '@database/models/role.model';
import { Vendor } from '@database/models/vendor.model';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Review } from '@database/models/review.model';
import { Wishlist } from '@database/models/wishlist.model';
import { WishlistItem } from '@database/models/wishlistItem.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { Shipment } from '@database/models/shipment.model';
import { DeliveryCashDeposit } from '@database/models/deliveryCashDeposit.model';
import { sequelize } from '@database/models';
import type { Transaction } from 'sequelize';
import { QueryTypes, Op } from 'sequelize';
import {
  ROLES,
  USER_STATUS,
  ORDER_STATUS,
  COMMISSION_STATUS,
  RETURN_STATUS,
} from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PERMISSIONS, type PermissionKey } from '@core/permissions/permissionKeys';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { ValidationError } from '@core/errors/ValidationError';
import { logAudit } from '@modules/audit/audit.service';
import { sumRupees, toPaise } from '@modules/pricing/money';
import type {
  UpdateUserProfileRequest,
  UpdateUserStatusRequest,
  UpdateUserRoleRequest,
  GetUsersQuery,
  CreateAddressRequest,
  UpdateAddressRequest,
  ListAssigneesQuery,
} from './users.dto';

const ASSIGNEE_PERMISSIONS = [PERMISSIONS.TICKET_MANAGE, PERMISSIONS.BUG_REPORT_MANAGE] as const;

const ACTIVE_FULFILLMENT_STATUSES = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.SHIPPED,
] as const;

const TERMINAL_SHIPMENT_STATUSES = ['DELIVERED', 'FAILED', 'RTO_DELIVERED'] as const;

async function countOtherActiveSuperAdmins(userId: string, transaction: Transaction): Promise<number> {
  const countRows = await sequelize.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM users u
     INNER JOIN roles r ON r.id = u."roleId" AND r."deletedAt" IS NULL
     WHERE u."deletedAt" IS NULL
       AND u.status = :status
       AND r.name = :superAdmin
       AND u.id != :userId`,
    {
      replacements: {
        status: USER_STATUS.ACTIVE,
        superAdmin: ROLES.SUPER_ADMIN,
        userId,
      },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  return Number(countRows[0]?.count ?? 0);
}

async function assertSelfDeletionAllowed(
  user: { id: string; vendorId?: string | null; role?: { name?: string } },
  transaction: Transaction,
): Promise<void> {
  const roleName = user.role?.name;

  if (roleName === ROLES.SUPER_ADMIN) {
    const others = await countOtherActiveSuperAdmins(user.id, transaction);
    if (others === 0) {
      throw new ForbiddenError('Cannot delete the sole Super Administrator account');
    }
    return;
  }

  if (roleName === ROLES.VENDOR_OWNER || roleName === ROLES.VENDOR_STAFF) {
    if (!user.vendorId) return;
    const [activeSuborders, pendingCommission] = await Promise.all([
      SubOrder.count({
        where: {
          vendorId: user.vendorId,
          status: { [Op.in]: [...ACTIVE_FULFILLMENT_STATUSES] },
        },
        transaction,
      }),
      CommissionLedger.count({
        where: { vendorId: user.vendorId, status: COMMISSION_STATUS.PENDING },
        transaction,
      }),
    ]);
    if (activeSuborders > 0) {
      throw new ForbiddenError(
        `You have ${activeSuborders} active suborders in progress — settle these before deleting your account`,
      );
    }
    if (pendingCommission > 0) {
      throw new ForbiddenError(
        `You have ${pendingCommission} pending commission ledger entries — settle these before deleting your account`,
      );
    }
    return;
  }

  if (roleName === ROLES.DELIVERY_AGENT) {
    const agent = await DeliveryAgent.findOne({
      where: { userId: user.id },
      transaction,
    });
    if (!agent) return;

    const [activeShipments, activePickups, collectedRows, verifiedDeposits] = await Promise.all([
      Shipment.count({
        where: {
          deliveryAgentId: agent.id,
          status: { [Op.notIn]: [...TERMINAL_SHIPMENT_STATUSES] },
        },
        transaction,
      }),
      ReturnRequest.count({
        where: {
          deliveryAgentId: agent.id,
          status: RETURN_STATUS.PICKUP_SCHEDULED,
        },
        transaction,
      }),
      Shipment.findAll({
        where: { deliveryAgentId: agent.id, codCollected: true },
        attributes: ['codAmount'],
        transaction,
      }),
      DeliveryCashDeposit.findAll({
        where: { deliveryAgentId: agent.id, status: 'VERIFIED' },
        attributes: ['amount'],
        transaction,
      }),
    ]);
    if (activeShipments > 0) {
      throw new ForbiddenError(
        `You have ${activeShipments} active shipments in progress — settle these before deleting your account`,
      );
    }
    if (activePickups > 0) {
      throw new ForbiddenError(
        `You have ${activePickups} scheduled return pickups — settle these before deleting your account`,
      );
    }
    // Compared in paise: a float difference of rupee sums can be a hair above 0
    // (0.1 + 0.2 − 0.3) and would block an agent who owes nothing.
    const collectedPaise = toPaise(sumRupees(collectedRows.map((row) => row.codAmount)));
    const depositedPaise = toPaise(sumRupees(verifiedDeposits.map((row) => row.amount)));
    if (collectedPaise > depositedPaise) {
      throw new ForbiddenError(
        'You have outstanding undeposited COD cash — settle this before deleting your account',
      );
    }
    return;
  }

  if (roleName === ROLES.CUSTOMER) {
    const activeOrders = await Order.count({
      where: {
        userId: user.id,
        status: { [Op.in]: [...ACTIVE_FULFILLMENT_STATUSES] },
      },
      transaction,
    });
    if (activeOrders > 0) {
      throw new ForbiddenError(
        `You have ${activeOrders} active orders in progress — settle these before deleting your account`,
      );
    }
  }
}

export type AssigneeCandidate = {
  id: string;
  name: string;
  email: string;
};

function serializeAddress(address: {
  id: string;
  userId: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  country: string;
  pincode: string;
  gstin?: string | null;
  isDefault: boolean;
  deliveryInstructions?: string | null;
  lat?: number | null;
  lng?: number | null;
}) {
  return {
    id: address.id,
    userId: address.userId,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    country: address.country,
    pincode: address.pincode,
    gstin: address.gstin ?? null,
    isDefault: Boolean(address.isDefault),
    deliveryInstructions: address.deliveryInstructions ?? null,
    lat: address.lat != null ? Number(address.lat) : null,
    lng: address.lng != null ? Number(address.lng) : null,
  };
}

function serializeProfile(user: any) {
  const plain = typeof user.get === 'function' ? user.get({ plain: true }) : user;
  const roleName = plain.role?.name ?? plain.Role?.name ?? null;

  return {
    id: plain.id,
    email: plain.email,
    name: plain.name,
    phone: plain.phone ?? null,
    role: roleName,
    status: plain.status ?? null,
    vendorId: plain.vendorId ?? null,
    emailVerified: Boolean(plain.emailVerified),
    emailMarketingConsent: Boolean(plain.emailMarketingConsent),
    avatarUrl: plain.avatarUrl ?? null,
    createdAt: plain.createdAt,
  };
}

const profileInclude = [
  { model: Role, as: 'role' },
  { model: Vendor, as: 'vendor' },
];

export class UsersService {
  async getProfile(userId: string) {
    const user = await usersRepository.findById(userId, { include: profileInclude });
    if (!user) throw new NotFoundError('User');
    return serializeProfile(user);
  }

  async updateProfile(userId: string, data: UpdateUserProfileRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, { transaction: t });
      if (!user) throw new NotFoundError('User');

      const patch: Record<string, unknown> = {};
      if (data.name !== undefined) patch.name = data.name;
      if (data.phone !== undefined) patch.phone = data.phone;
      if (data.emailMarketingConsent !== undefined) {
        patch.emailMarketingConsent = data.emailMarketingConsent;
      }
      if (data.avatarUrl !== undefined) {
        patch.avatarUrl = data.avatarUrl;
      }

      await usersRepository.update(userId, patch as any, { transaction: t });

      if (data.avatarUrl !== undefined) {
        await deleteS3ObjectIfReplaced(user.avatarUrl, data.avatarUrl);
      }

      const updated = await usersRepository.findById(userId, {
        include: profileInclude,
        transaction: t,
      });
      return serializeProfile(updated!);
    });
  }

  async exportAccountData(userId: string) {
    const user = await usersRepository.findById(userId, { include: profileInclude });
    if (!user) throw new NotFoundError('User');

    const [addresses, orders, reviews, returns, wishlists] = await Promise.all([
      addressesRepository.findByUserId(userId),
      Order.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit: 200,
      }),
      Review.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
      ReturnRequest.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
      Wishlist.findAll({
        where: { userId },
        include: [{ model: WishlistItem, as: 'items' }],
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      profile: serializeProfile(user),
      addresses: addresses.map(serializeAddress),
      orders,
      reviews,
      returns,
      wishlists,
    };
  }

  async listAddresses(userId: string) {
    const addresses = await addressesRepository.findByUserId(userId);
    return addresses.map(serializeAddress);
  }

  async createAddress(userId: string, data: CreateAddressRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const existing = await addressesRepository.findByUserId(userId);
      const makeDefault = Boolean(data.isDefault) || existing.length === 0;

      if (makeDefault) {
        await addressesRepository.clearDefaultsForUser(userId, { transaction: t });
      }

      const address = await addressesRepository.create(
        {
          userId,
          line1: data.line1,
          line2: data.line2 ?? null,
          city: data.city,
          state: data.state,
          country: data.country || 'India',
          pincode: data.pincode,
          gstin: data.gstin ?? null,
          isDefault: makeDefault,
          deliveryInstructions: data.deliveryInstructions ?? null,
          lat: data.lat,
          lng: data.lng,
        } as any,
        { transaction: t },
      );

      return serializeAddress(address);
    });
  }

  async updateAddress(userId: string, addressId: string, data: UpdateAddressRequest) {
    return sequelize.transaction(async (t: Transaction) => {
      const address = await addressesRepository.findById(addressId, { transaction: t });
      if (!address || address.userId !== userId) throw new NotFoundError('Address');

      if (data.isDefault === true) {
        await addressesRepository.clearDefaultsForUser(userId, { transaction: t });
      }

      const nextIsDefault =
        data.isDefault === undefined ? address.isDefault : Boolean(data.isDefault);

      await addressesRepository.update(
        addressId,
        {
          ...(data.line1 !== undefined ? { line1: data.line1 } : {}),
          ...(data.line2 !== undefined ? { line2: data.line2 } : {}),
          ...(data.city !== undefined ? { city: data.city } : {}),
          ...(data.state !== undefined ? { state: data.state } : {}),
          ...(data.country !== undefined ? { country: data.country } : {}),
          ...(data.pincode !== undefined ? { pincode: data.pincode } : {}),
          ...(data.gstin !== undefined ? { gstin: data.gstin } : {}),
          ...(data.deliveryInstructions !== undefined
            ? { deliveryInstructions: data.deliveryInstructions }
            : {}),
          ...(data.lat !== undefined ? { lat: data.lat } : {}),
          ...(data.lng !== undefined ? { lng: data.lng } : {}),
          ...(data.isDefault !== undefined ? { isDefault: nextIsDefault } : {}),
        } as any,
        { transaction: t },
      );

      if (data.isDefault === false && address.isDefault) {
        const remaining = await addressesRepository.findByUserId(userId, { transaction: t });
        const next = remaining.find((row) => row.id !== addressId);
        if (next) {
          await addressesRepository.update(next.id, { isDefault: true } as any, {
            transaction: t,
          });
        } else {
          await addressesRepository.update(addressId, { isDefault: true } as any, {
            transaction: t,
          });
        }
      }

      const updated = await addressesRepository.findById(addressId, { transaction: t });
      return serializeAddress(updated!);
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const address = await addressesRepository.findById(addressId, { transaction: t });
      if (!address || address.userId !== userId) throw new NotFoundError('Address');

      const wasDefault = address.isDefault;
      await addressesRepository.softDelete(addressId, { transaction: t });

      if (wasDefault) {
        const remaining = await addressesRepository.findByUserId(userId, { transaction: t });
        const next = remaining.find((row) => row.id !== addressId);
        if (next) {
          await addressesRepository.update(next.id, { isDefault: true } as any, {
            transaction: t,
          });
        }
      }
    });
  }

  async setDefaultAddress(userId: string, addressId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const address = await addressesRepository.findById(addressId, { transaction: t });
      if (!address || address.userId !== userId) throw new NotFoundError('Address');

      await addressesRepository.clearDefaultsForUser(userId, { transaction: t });
      await addressesRepository.update(addressId, { isDefault: true } as any, { transaction: t });

      const updated = await addressesRepository.findById(addressId, { transaction: t });
      return serializeAddress(updated!);
    });
  }

  async deleteOwnAccount(userId: string) {
    return sequelize.transaction(async (t: Transaction) => {
      const user = await usersRepository.findById(userId, {
        include: [{ model: Role, as: 'role' }],
        transaction: t,
      });
      if (!user) throw new NotFoundError('User');
      await assertSelfDeletionAllowed(
        {
          id: user.id,
          vendorId: user.vendorId,
          role: (user as { role?: { name?: string } }).role,
        },
        t,
      );
      await authRepository.deleteRefreshTokensByUser(userId);
      await usersRepository.softDelete(userId, { transaction: t });
    }).then(async () => {
      await cascadeDeleteEntityMedia(S3_ENTITY_TYPES.USERS, userId);
    });
  }

  /** Roles for the admin user-list role filter dropdown. */
  async listRoles(): Promise<Array<{ id: string; name: string }>> {
    const roles = await Role.findAll({
      attributes: ['id', 'name'],
      order: [['name', 'ASC']],
    });
    return roles.map((role) => {
      const plain = role.get({ plain: true }) as { id: string; name: string };
      return { id: plain.id, name: plain.name };
    });
  }

  async getUsers(query: GetUsersQuery) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await usersRepository.findWithFilters({
      roleId: query.roleId,
      status: query.status,
      search: query.search,
      limit: query.limit,
      offset,
    });

    return {
      users: rows.map(serializeProfile),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  /**
   * Active users whose role grants the given manage permission (or SUPER_ADMIN).
   * Caller must already hold the same permission.
   */
  async listAssignees(
    actor: { roleId: string; role: { name: string } },
    query: ListAssigneesQuery,
  ) {
    const permission = query.permission;
    if (!(ASSIGNEE_PERMISSIONS as readonly string[]).includes(permission)) {
      throw new ForbiddenError(ERROR_MESSAGES.AUTH_REQUIRED);
    }

    const actorPerms = await resolvePermissionsForUser(actor);
    if (!actorPerms.includes(permission as PermissionKey)) {
      throw new ForbiddenError(ERROR_MESSAGES.FORBIDDEN);
    }

    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await this.findAssigneesPage({
      permission,
      limit: query.limit,
      offset,
      search: query.search,
      vendorId: query.vendorId,
    });

    return {
      users: rows,
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async findAssigneesByPermission(
    permission: (typeof ASSIGNEE_PERMISSIONS)[number],
    limit = 100,
  ): Promise<AssigneeCandidate[]> {
    const { rows } = await this.findAssigneesPage({ permission, limit, offset: 0 });
    return rows;
  }

  async findAssigneesPage(params: {
    permission: (typeof ASSIGNEE_PERMISSIONS)[number];
    limit: number;
    offset: number;
    search?: string;
    vendorId?: string;
  }): Promise<{ rows: AssigneeCandidate[]; count: number }> {
    const search = params.search?.trim();
    const searchPattern = search ? `%${search}%` : null;
    const includeVendorMembers =
      params.permission === PERMISSIONS.TICKET_MANAGE && Boolean(params.vendorId);

    const whereSql = `
      FROM users u
      INNER JOIN roles r ON r.id = u."roleId" AND r."deletedAt" IS NULL
      WHERE u."deletedAt" IS NULL
        AND u.status = :status
        AND (
          r.name = :superAdmin
          OR EXISTS (
            SELECT 1
            FROM "RolePermissions" rp
            INNER JOIN permissions p ON p.id = rp."permissionId" AND p."deletedAt" IS NULL
            WHERE rp."roleId" = u."roleId" AND p.key = :permission
          )
          OR (
            :includeVendorMembers
            AND u."vendorId" = :vendorId
            AND r.name IN (:vendorOwner, :vendorStaff)
          )
        )
        AND (
          :searchPattern::text IS NULL
          OR u.name ILIKE :searchPattern
          OR u.email ILIKE :searchPattern
        )
    `;

    const replacements = {
      status: USER_STATUS.ACTIVE,
      superAdmin: ROLES.SUPER_ADMIN,
      permission: params.permission,
      searchPattern,
      includeVendorMembers,
      vendorId: params.vendorId ?? null,
      vendorOwner: ROLES.VENDOR_OWNER,
      vendorStaff: ROLES.VENDOR_STAFF,
      limit: params.limit,
      offset: params.offset,
    };

    const countRows = await sequelize.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM (
         SELECT DISTINCT u.id
         ${whereSql}
       ) counted`,
      { replacements, type: QueryTypes.SELECT },
    );

    const rows = await sequelize.query<AssigneeCandidate>(
      `SELECT DISTINCT u.id, u.name, u.email
       ${whereSql}
       ORDER BY u.name ASC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT },
    );

    return {
      rows,
      count: Number(countRows[0]?.count ?? 0),
    };
  }

  /** Ensures the user exists, is active, and holds the given manage permission. */
  async assertAssignableUser(
    userId: string,
    permission: (typeof ASSIGNEE_PERMISSIONS)[number],
    transaction?: Transaction,
  ): Promise<void> {
    const rows = await sequelize.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId" AND r."deletedAt" IS NULL
       WHERE u.id = :userId
         AND u."deletedAt" IS NULL
         AND u.status = :status
         AND (
           r.name = :superAdmin
           OR EXISTS (
             SELECT 1
             FROM "RolePermissions" rp
             INNER JOIN permissions p ON p.id = rp."permissionId" AND p."deletedAt" IS NULL
             WHERE rp."roleId" = u."roleId" AND p.key = :permission
           )
         )
       LIMIT 1`,
      {
        replacements: {
          userId,
          status: USER_STATUS.ACTIVE,
          superAdmin: ROLES.SUPER_ADMIN,
          permission,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    if (rows.length === 0) {
      throw new ValidationError(ERROR_MESSAGES.USER_NOT_FOUND_OR_BLOCKED);
    }
  }

  /**
   * Ticket reassignment: allow TICKET_MANAGE holders, or active vendor
   * owner/staff belonging to the ticket's related vendor.
   */
  async assertTicketAssignee(
    userId: string,
    relatedVendorId: string | null,
    transaction?: Transaction,
  ): Promise<void> {
    const rows = await sequelize.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       INNER JOIN roles r ON r.id = u."roleId" AND r."deletedAt" IS NULL
       WHERE u.id = :userId
         AND u."deletedAt" IS NULL
         AND u.status = :status
         AND (
           r.name = :superAdmin
           OR EXISTS (
             SELECT 1
             FROM "RolePermissions" rp
             INNER JOIN permissions p ON p.id = rp."permissionId" AND p."deletedAt" IS NULL
             WHERE rp."roleId" = u."roleId" AND p.key = :permission
           )
           OR (
             :relatedVendorId::uuid IS NOT NULL
             AND u."vendorId" = :relatedVendorId
             AND r.name IN (:vendorOwner, :vendorStaff)
           )
         )
       LIMIT 1`,
      {
        replacements: {
          userId,
          status: USER_STATUS.ACTIVE,
          superAdmin: ROLES.SUPER_ADMIN,
          permission: PERMISSIONS.TICKET_MANAGE,
          relatedVendorId,
          vendorOwner: ROLES.VENDOR_OWNER,
          vendorStaff: ROLES.VENDOR_STAFF,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    if (rows.length === 0) {
      throw new ValidationError(ERROR_MESSAGES.USER_NOT_FOUND_OR_BLOCKED);
    }
  }

  async getUserById(userId: string) {
    const user = await usersRepository.findById(userId, { include: profileInclude });
    if (!user) throw new NotFoundError('User');
    return serializeProfile(user);
  }

  async updateUserStatus(
    userId: string,
    data: UpdateUserStatusRequest,
    actor?: { id: string; role?: { name: string } },
  ) {
    return sequelize.transaction(async (t: Transaction) => {
      if (actor?.id === userId) {
        throw new ForbiddenError('Cannot change your own account status — ask another administrator');
      }

      const user = await usersRepository.findById(userId, {
        include: [{ model: Role, as: 'role' }],
        transaction: t,
      });
      if (!user) throw new NotFoundError('User');

      const targetRoleName = (user as any).role?.name;
      const actorRoleName = actor?.role?.name;

      if (targetRoleName === ROLES.SUPER_ADMIN && actorRoleName !== ROLES.SUPER_ADMIN) {
        throw new ForbiddenError('Cannot modify status of a super administrator');
      }

      await usersRepository.update(userId, data, { transaction: t });

      if (data.status === USER_STATUS.BLOCKED) {
        await authRepository.deleteRefreshTokensByUser(userId);
      }

      if (actor) {
        await logAudit({
          actorId: actor.id,
          action: 'USER_STATUS_UPDATED',
          entityType: 'User',
          entityId: userId,
          metadata: { previousStatus: user.status, newStatus: data.status },
          transaction: t,
        });
      }

      return this.getUserById(userId);
    });
  }

  async updateUserRole(
    userId: string,
    data: UpdateUserRoleRequest,
    actor: { id: string; role: { name: string } },
  ) {
    return sequelize.transaction(async (t: Transaction) => {
      if (actor.id === userId) {
        throw new ForbiddenError('Cannot change your own role — ask another administrator');
      }

      const user = await usersRepository.findById(userId, {
        include: [{ model: Role, as: 'role' }],
        transaction: t,
      });
      if (!user) throw new NotFoundError('User');

      const newRole = await Role.findByPk(data.roleId, { transaction: t });
      if (!newRole) throw new NotFoundError('Role');

      const targetRoleName = (user as any).role?.name;
      const isActorSuperAdmin = actor.role.name === ROLES.SUPER_ADMIN;

      if (targetRoleName === ROLES.SUPER_ADMIN && !isActorSuperAdmin) {
        throw new ForbiddenError('Only super administrators can modify a super administrator');
      }
      if (newRole.name === ROLES.SUPER_ADMIN && !isActorSuperAdmin) {
        throw new ForbiddenError('Only super administrators can assign the super administrator role');
      }

      const isVendorRole = newRole.name === ROLES.VENDOR_OWNER || newRole.name === ROLES.VENDOR_STAFF;
      let newVendorId = user.vendorId;

      if (isVendorRole) {
        if (data.vendorId !== undefined) {
          newVendorId = data.vendorId;
        }
        if (!newVendorId) {
          throw new ValidationError('A vendor store must be selected for vendor roles');
        }
      } else {
        newVendorId = null;
      }

      const previousRoleId = user.roleId;
      const previousVendorId = user.vendorId;
      await usersRepository.update(
        userId,
        { roleId: newRole.id, vendorId: newVendorId } as any,
        { transaction: t },
      );
      await authRepository.deleteRefreshTokensByUser(userId);

      await logAudit({
        actorId: actor.id,
        action: 'USER_ROLE_UPDATED',
        entityType: 'User',
        entityId: userId,
        metadata: {
          previousRoleId,
          previousRoleName: targetRoleName,
          previousVendorId,
          newRoleId: newRole.id,
          newRoleName: newRole.name,
          newVendorId,
        },
        transaction: t,
      });

      return this.getUserById(userId);
    });
  }

  async deleteUser(userId: string, actor?: { id: string; role?: { name: string } }) {
    await sequelize.transaction(async (t: Transaction) => {
      if (actor?.id === userId) {
        throw new ForbiddenError('Cannot delete your own account — ask another administrator');
      }

      const user = await usersRepository.findById(userId, {
        include: [{ model: Role, as: 'role' }],
        transaction: t,
      });
      if (!user) throw new NotFoundError('User');

      const targetRoleName = (user as any).role?.name;
      if (targetRoleName === ROLES.SUPER_ADMIN) {
        throw new ForbiddenError('Cannot delete a super administrator');
      }

      await authRepository.deleteRefreshTokensByUser(userId);
      await usersRepository.softDelete(userId, { transaction: t });

      if (actor) {
        await logAudit({
          actorId: actor.id,
          action: 'USER_DELETED',
          entityType: 'User',
          entityId: userId,
          transaction: t,
        });
      }
    });
    await cascadeDeleteEntityMedia(S3_ENTITY_TYPES.USERS, userId);
  }
}

export const usersService = new UsersService();
