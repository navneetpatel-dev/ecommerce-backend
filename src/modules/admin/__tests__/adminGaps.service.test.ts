import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { usersService } from '../../users/users.service';
import { authService } from '../../auth/auth.service';
import { ordersCancelService } from '../../orders/ordersCancel.service';
import { vendorsService } from '../../vendors/vendors.service';
import { productsService } from '../../products/products.service';
import { shippingService } from '../../shipping/shipping.service';
import { User } from '../../users/user.model';
import { Role } from '../../roles/role.model';
import { RefreshToken } from '../../auth/refreshToken.model';
import { Order } from '../../orders/order.model';
import { SubOrder } from '../../orders/subOrder.model';
import { Product } from '../../products/product.model';
import { ShippingRate } from '../../shipping/shippingRate.model';
import { auditLogService } from '../../audit/auditLog.service';
import { AppError } from '@core/errors/AppError';
import { USER_STATUS, ORDER_STATUS, SUB_ORDER_STATUS, PRODUCT_STATUS } from '@core/constants/statuses';

describe('Admin Gaps Fixes Test Suite', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe('User Role and Status Management with Super Admin Guards', () => {
    it('prevents modifying role of SUPER_ADMIN user', async () => {
      mock.method(User, 'findByPk', async () => ({
        id: 'superadmin-1',
        role: { name: 'SUPER_ADMIN' },
      }));

      await assert.rejects(
        async () => {
          await usersService.updateUserRole(
            'superadmin-1',
            { roleId: 'role-new' },
            { id: 'actor-admin', role: 'ADMIN' } as any
          );
        },
        (err: AppError) => {
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /SUPER_ADMIN/i);
          return true;
        }
      );
    });

    it('updates user role, revokes refresh tokens, and logs audit', async () => {
      let tokensDestroyed = false;
      let auditLogged = false;

      mock.method(User, 'findByPk', async (id: string) => {
        if (id === 'user-1') {
          return {
            id: 'user-1',
            roleId: 'role-old',
            role: { name: 'CUSTOMER' },
            update: async () => {},
          };
        }
        return {
          id: 'user-1',
          roleId: 'role-new',
          role: { id: 'role-new', name: 'VENDOR' },
          toJSON: () => ({ id: 'user-1', roleId: 'role-new', role: 'VENDOR' }),
        };
      });

      mock.method(Role, 'findByPk', async () => ({
        id: 'role-new',
        name: 'VENDOR',
      }));

      mock.method(RefreshToken, 'destroy', async () => {
        tokensDestroyed = true;
        return 1;
      });

      mock.method(auditLogService, 'log', async (params) => {
        auditLogged = true;
        assert.equal(params.action, 'USER_ROLE_UPDATED');
        assert.equal(params.entityId, 'user-1');
      });

      const updated = await usersService.updateUserRole(
        'user-1',
        { roleId: 'role-new' },
        { id: 'admin-1', role: 'ADMIN' } as any
      );

      assert.equal(tokensDestroyed, true);
      assert.equal(auditLogged, true);
      assert.ok(updated);
    });

    it('prevents blocking a SUPER_ADMIN user', async () => {
      mock.method(User, 'findByPk', async () => ({
        id: 'superadmin-1',
        role: { name: 'SUPER_ADMIN' },
      }));

      await assert.rejects(
        async () => {
          await usersService.updateUserStatus(
            'superadmin-1',
            { status: USER_STATUS.BLOCKED },
            { id: 'actor-admin', role: 'ADMIN' } as any
          );
        },
        (err: AppError) => {
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /SUPER_ADMIN/i);
          return true;
        }
      );
    });

    it('revokes refresh tokens when user is blocked', async () => {
      let tokensDestroyed = false;

      mock.method(User, 'findByPk', async () => ({
        id: 'user-2',
        status: USER_STATUS.ACTIVE,
        role: { name: 'CUSTOMER' },
        update: async () => {},
      }));

      mock.method(RefreshToken, 'destroy', async () => {
        tokensDestroyed = true;
        return 1;
      });

      mock.method(auditLogService, 'log', async () => {});

      await usersService.updateUserStatus(
        'user-2',
        { status: USER_STATUS.BLOCKED },
        { id: 'admin-1', role: 'ADMIN' } as any
      );

      assert.equal(tokensDestroyed, true);
    });
  });

  describe('Impersonation Privilege Escalation Guard', () => {
    it('disallows non-superadmin from impersonating admin/staff roles', async () => {
      mock.method(User, 'findByPk', async () => ({
        id: 'admin-target',
        email: 'staff@example.com',
        role: { name: 'ADMIN' },
      }));

      await assert.rejects(
        async () => {
          await authService.impersonateUser(
            'admin-target',
            { id: 'admin-actor', role: 'ADMIN' } as any
          );
        },
        (err: AppError) => {
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /Only SUPER_ADMIN can impersonate administrative/i);
          return true;
        }
      );
    });
  });

  describe('Admin Order Cancellation Cascade', () => {
    it('cancels unpaid or COD orders, cascades suborders, and logs audit', async () => {
      let subOrdersCancelled = false;
      let auditLogged = false;

      const mockOrder = {
        id: 'order-1',
        paymentStatus: 'PENDING',
        paymentMethod: 'COD',
        status: ORDER_STATUS.PENDING,
        items: [],
        update: async () => {},
        save: async () => {},
      };

      mock.method(Order, 'findByPk', async () => mockOrder);
      mock.method(SubOrder, 'update', async (values: any) => {
        if (values.status === SUB_ORDER_STATUS.CANCELLED) {
          subOrdersCancelled = true;
        }
        return [1];
      });

      mock.method(auditLogService, 'log', async (params) => {
        auditLogged = true;
        assert.equal(params.action, 'ORDER_CANCELLED');
        assert.equal(params.entityId, 'order-1');
      });

      const result = await ordersCancelService.cancelOrder('order-1', 'admin-1', 'Admin manual cancel');

      assert.equal(result.cancelled, true);
      assert.equal(subOrdersCancelled, true);
      assert.equal(auditLogged, true);
    });
  });

  describe('Vendor Deletion Safeguards', () => {
    it('blocks deletion if active suborders exist', async () => {
      mock.method(SubOrder, 'count', async () => 2);

      await assert.rejects(
        async () => {
          await vendorsService.deleteVendor('vendor-1', 'admin-1');
        },
        (err: AppError) => {
          assert.equal(err.statusCode, 409);
          assert.match(err.message, /Cannot delete vendor with 2 active suborder/i);
          return true;
        }
      );
    });
  });

  describe('Product Unarchive Feature', () => {
    it('unarchives an ARCHIVED product back to ACTIVE and logs audit', async () => {
      let productStatus: string = PRODUCT_STATUS.ARCHIVED;
      let auditLogged = false;

      mock.method(Product, 'findByPk', async () => ({
        id: 'prod-1',
        status: PRODUCT_STATUS.ARCHIVED,
        update: async (fields: any) => {
          productStatus = fields.status;
        },
      }));

      mock.method(auditLogService, 'log', async (params) => {
        auditLogged = true;
        assert.equal(params.action, 'PRODUCT_UNARCHIVED');
        assert.equal(params.entityId, 'prod-1');
      });

      const result = await productsService.unarchiveProduct('prod-1', 'admin-1');

      assert.equal(productStatus, PRODUCT_STATUS.ACTIVE);
      assert.equal(auditLogged, true);
      assert.equal(result.status, PRODUCT_STATUS.ACTIVE);
    });
  });

  describe('Shipping Rates Management', () => {
    it('updates shipping rate and logs audit', async () => {
      let auditLogged = false;

      mock.method(ShippingRate, 'findByPk', async () => ({
        id: 'rate-1',
        price: 50,
        update: async (fields: any) => ({ ...fields, id: 'rate-1' }),
      }));

      mock.method(auditLogService, 'log', async (params) => {
        auditLogged = true;
        assert.equal(params.action, 'SHIPPING_RATE_UPDATED');
        assert.equal(params.entityId, 'rate-1');
      });

      await shippingService.updateRate('rate-1', { price: 60 }, 'admin-1');

      assert.equal(auditLogged, true);
    });

    it('deletes shipping rate and logs audit', async () => {
      let destroyed = false;
      let auditLogged = false;

      mock.method(ShippingRate, 'findByPk', async () => ({
        id: 'rate-1',
        destroy: async () => {
          destroyed = true;
        },
      }));

      mock.method(auditLogService, 'log', async (params) => {
        auditLogged = true;
        assert.equal(params.action, 'SHIPPING_RATE_DELETED');
        assert.equal(params.entityId, 'rate-1');
      });

      await shippingService.deleteRate('rate-1', 'admin-1');

      assert.equal(destroyed, true);
      assert.equal(auditLogged, true);
    });
  });
});
