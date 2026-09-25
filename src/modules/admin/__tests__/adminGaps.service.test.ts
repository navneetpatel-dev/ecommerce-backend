import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { AuditLog } from '@database/models/auditLog.model';
import { Role } from '@database/models/role.model';
import { SubOrder } from '@database/models/subOrder.model';
import { ShippingRate } from '@database/models/shippingRate.model';
import { User } from '@database/models/user.model';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { PRODUCT_STATUS, ROLES, USER_STATUS } from '@core/constants/statuses';
import { usersService } from '../../users/users.service';
import { usersRepository } from '../../users/users.repository';
import { authRepository } from '../../auth/auth.repository';
import { authService } from '../../auth/auth.service';
import { vendorsService } from '../../vendors/vendors.service';
import { vendorsRepository } from '../../vendors/vendors.repository';
import { productsService } from '../../products/products.service';
import { productsRepository } from '../../products/products.repository';
import { shippingService } from '../../shipping/shipping.service';

type AuditRow = { actorId: string; action: string; entityId: string };

/** Run service transactions inline and capture audit rows instead of writing them. */
function stubInfrastructure(): AuditRow[] {
  const audit: AuditRow[] = [];
  mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) =>
    callback({ LOCK: { UPDATE: 'UPDATE' } }),
  );
  mock.method(AuditLog, 'create', async (row: AuditRow) => {
    audit.push(row);
    return row as never;
  });
  return audit;
}

const admin = { id: 'admin-1', role: { name: ROLES.ADMIN_ORDER_MANAGER } };

describe('Admin gap fixes', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe('super admin guards on user role and status', () => {
    it('rejects changing a SUPER_ADMIN role from a non-super-admin', async () => {
      stubInfrastructure();
      mock.method(usersRepository, 'findById', async () => ({
        id: 'superadmin-1',
        role: { name: ROLES.SUPER_ADMIN },
      }) as never);
      mock.method(Role, 'findByPk', async () => ({ id: 'role-new', name: ROLES.CUSTOMER }) as never);

      await assert.rejects(
        () => usersService.updateUserRole('superadmin-1', { roleId: 'role-new' }, admin),
        (err: unknown) => err instanceof ForbiddenError && /super administrator/i.test(err.message),
      );
    });

    it('updates a role, revokes refresh tokens, and audits it', async () => {
      const audit = stubInfrastructure();
      let tokensRevokedFor: string | null = null;
      mock.method(usersRepository, 'findById', async () => ({
        id: 'user-1',
        roleId: 'role-old',
        vendorId: null,
        role: { name: ROLES.CUSTOMER },
      }) as never);
      mock.method(Role, 'findByPk', async () => ({ id: 'role-new', name: ROLES.CUSTOMER }) as never);
      mock.method(usersRepository, 'update', async () => [1] as never);
      mock.method(authRepository, 'deleteRefreshTokensByUser', async (userId: string) => {
        tokensRevokedFor = userId;
        return 1 as never;
      });
      mock.method(usersService, 'getUserById', async () => ({ id: 'user-1' }) as never);

      const updated = await usersService.updateUserRole('user-1', { roleId: 'role-new' }, admin);

      assert.deepEqual(updated, { id: 'user-1' });
      assert.equal(tokensRevokedFor, 'user-1');
      assert.deepEqual(
        audit.map((row) => [row.action, row.entityId]),
        [['USER_ROLE_UPDATED', 'user-1']],
      );
    });

    it('rejects blocking a SUPER_ADMIN from a non-super-admin', async () => {
      stubInfrastructure();
      mock.method(usersRepository, 'findById', async () => ({
        id: 'superadmin-1',
        role: { name: ROLES.SUPER_ADMIN },
      }) as never);

      await assert.rejects(
        () =>
          usersService.updateUserStatus('superadmin-1', { status: USER_STATUS.BLOCKED }, admin),
        (err: unknown) => err instanceof ForbiddenError && /super administrator/i.test(err.message),
      );
    });

    it('revokes refresh tokens when a user is blocked', async () => {
      const audit = stubInfrastructure();
      let tokensRevokedFor: string | null = null;
      mock.method(usersRepository, 'findById', async () => ({
        id: 'user-2',
        status: USER_STATUS.ACTIVE,
        role: { name: ROLES.CUSTOMER },
      }) as never);
      mock.method(usersRepository, 'update', async () => [1] as never);
      mock.method(authRepository, 'deleteRefreshTokensByUser', async (userId: string) => {
        tokensRevokedFor = userId;
        return 1 as never;
      });
      mock.method(usersService, 'getUserById', async () => ({ id: 'user-2' }) as never);

      await usersService.updateUserStatus('user-2', { status: USER_STATUS.BLOCKED }, admin);

      assert.equal(tokensRevokedFor, 'user-2');
      assert.equal(audit[0]?.action, 'USER_STATUS_UPDATED');
    });
  });

  describe('impersonation privilege escalation guard', () => {
    it('only a super admin can impersonate an admin account', async () => {
      mock.method(User, 'findByPk', async () => ({
        id: 'admin-target',
        email: 'staff@example.com',
        roleId: 'role-admin',
        role: { name: ROLES.ADMIN_CATALOG_MANAGER },
      }) as never);

      await assert.rejects(
        () => authService.impersonateUser(admin, 'admin-target'),
        (err: unknown) =>
          err instanceof ForbiddenError &&
          /Only super administrators can impersonate administrative/i.test(err.message),
      );
    });
  });

  describe('vendor deletion safeguard', () => {
    it('blocks deleting a vendor with active sub-orders', async () => {
      stubInfrastructure();
      mock.method(vendorsRepository, 'findById', async () => ({ id: 'vendor-1' }) as never);
      mock.method(SubOrder, 'count', async () => 2);

      await assert.rejects(
        () => vendorsService.deleteVendor('vendor-1', 'admin-1'),
        (err: unknown) =>
          err instanceof ValidationError && /active suborders/i.test(err.message),
      );
    });
  });

  describe('product unarchive', () => {
    it('returns an archived product to DRAFT for re-review and audits it', async () => {
      const audit = stubInfrastructure();
      let savedStatus: string | null = null;
      mock.method(productsRepository, 'findById', async () => ({
        id: 'prod-1',
        name: 'Lamp',
        status: PRODUCT_STATUS.ARCHIVED,
      }) as never);
      mock.method(productsRepository, 'update', async (_id: string, fields: { status: string }) => {
        savedStatus = fields.status;
        return [1] as never;
      });
      mock.method(productsService, 'getProductById', async () => ({ id: 'prod-1' }) as never);

      await productsService.unarchiveProduct('prod-1', 'admin-1');

      assert.equal(savedStatus, PRODUCT_STATUS.DRAFT);
      assert.deepEqual(
        audit.map((row) => [row.action, row.entityId]),
        [['PRODUCT_UNARCHIVED', 'prod-1']],
      );
    });

    it('refuses to unarchive a product that is not archived', async () => {
      stubInfrastructure();
      mock.method(productsRepository, 'findById', async () => ({
        id: 'prod-2',
        status: PRODUCT_STATUS.ACTIVE,
      }) as never);

      await assert.rejects(
        () => productsService.unarchiveProduct('prod-2', 'admin-1'),
        ValidationError,
      );
    });
  });

  describe('shipping rate management', () => {
    it('updates a shipping rate and audits it', async () => {
      const audit = stubInfrastructure();
      let patch: Record<string, unknown> | null = null;
      mock.method(ShippingRate, 'findByPk', async () => ({
        id: 'rate-1',
        update: async (fields: Record<string, unknown>) => {
          patch = fields;
        },
      }) as never);

      await shippingService.updateRate('rate-1', { price: 60 }, 'admin-1');

      assert.deepEqual(patch, { price: 60, updatedBy: 'admin-1' });
      assert.equal(audit[0]?.action, 'SHIPPING_RATE_UPDATED');
    });

    it('deletes a shipping rate and audits it', async () => {
      const audit = stubInfrastructure();
      let destroyed = false;
      mock.method(ShippingRate, 'findByPk', async () => ({
        id: 'rate-1',
        destroy: async () => {
          destroyed = true;
        },
      }) as never);

      await shippingService.deleteRate('rate-1', 'admin-1');

      assert.equal(destroyed, true);
      assert.equal(audit[0]?.action, 'SHIPPING_RATE_DELETED');
    });
  });
});
