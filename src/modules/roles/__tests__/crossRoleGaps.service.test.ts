import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Request, Response, NextFunction } from 'express';
import { payoutsService } from '@modules/payouts/payouts.service';
import { Payout } from '@database/models/payout.model';
import { vendorsService } from '@modules/vendors/vendors.service';
import { vendorsRepository } from '@modules/vendors/vendors.repository';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { usersService } from '@modules/users/users.service';
import { RefreshToken } from '@database/models/refreshToken.model';
import { AuditLog } from '@database/models/auditLog.model';
import { requireVendorOwner } from '@modules/coupons/coupons.routes';
import { checkOwnership } from '@middleware/ownership.middleware';
import { Product } from '@database/models/product.model';
import { sequelize } from '@config/db';
import { usersRepository } from '@modules/users/users.repository';
import { authRepository } from '@modules/auth/auth.repository';
import { deliveryAgentsService } from '@modules/deliveryAgents/deliveryAgents.service';
import { DeliveryRating } from '@database/models/deliveryRating.model';
import { supportTicketsService } from '@modules/supportTickets/supportTickets.service';
import { SupportTicket } from '@database/models/supportTicket.model';
import { ROLES, SUPPORT_TICKET_STATUS } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { AppError } from '@core/errors/AppError';
import { setPermissionCache, clearPermissionCache } from '@middleware/rbac.middleware';

describe('Cross-Role & Dynamic RBAC Gap Fixes Verification', () => {
  afterEach(() => {
    mock.restoreAll();
    clearPermissionCache();
  });

  describe('1. Financial & Multi-Tenant: Payout IDOR Protection', () => {
    it('rejects access with 403 if a customer or mismatched actor attempts to view vendor payouts', async () => {
      const customerActor = {
        id: 'cust-1',
        role: { name: ROLES.CUSTOMER },
        vendorId: null,
      } as any;

      await assert.rejects(
        async () => {
          await payoutsService.listByVendor('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', customerActor);
        },
        (err: ForbiddenError) => {
          assert.equal(err.statusCode, 403);
          return true;
        },
      );
    });

    it('rejects access with 403 if a vendor attempts to view a DIFFERENT vendor payouts', async () => {
      const otherVendorActor = {
        id: 'vend-owner-2',
        role: { name: ROLES.VENDOR_OWNER },
        vendorId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22',
      } as any;

      await assert.rejects(
        async () => {
          await payoutsService.listByVendor('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', otherVendorActor);
        },
        (err: ForbiddenError) => {
          assert.equal(err.statusCode, 403);
          return true;
        },
      );
    });

    it('allows access if actor vendorId matches the requested vendorId', async () => {
      const matchingVendorActor = {
        id: 'vend-owner-1',
        role: { name: ROLES.VENDOR_OWNER },
        vendorId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      } as any;

      mock.method(Payout, 'findAll', async () => [
        { id: 'payout-1', vendorId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', amount: 5000 } as any,
      ]);

      const result = await payoutsService.listByVendor('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', matchingVendorActor);
      assert.equal(result.length, 1);
      assert.equal(result[0].id, 'payout-1');
    });

    it('allows access if actor is an admin (SUPER_ADMIN)', async () => {
      const adminActor = {
        id: 'admin-1',
        role: { name: ROLES.SUPER_ADMIN },
        vendorId: null,
      } as any;

      mock.method(Payout, 'findAll', async () => [
        { id: 'payout-1', vendorId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', amount: 5000 } as any,
      ]);

      const result = await payoutsService.listByVendor('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', adminActor);
      assert.equal(result.length, 1);
    });
  });

  describe('2. Financial: VENDOR_STAFF updateMyVendor Restrictions', () => {
    it('blocks VENDOR_STAFF from altering bank details or financial settings', async () => {
      const staffActor = {
        id: 'staff-1',
        role: { name: ROLES.VENDOR_STAFF },
        vendorId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      } as any;

      await assert.rejects(
        async () => {
          await vendorsService.updateMyVendor(
            'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
            {
              bankDetails: {
                accountHolderName: 'Malicious Staff',
                accountNumber: '9999999999',
                ifscCode: 'HDFC0001234',
                bankName: 'HDFC Bank',
              },
            } as any,
            staffActor,
          );
        },
        (err: ForbiddenError) => {
          assert.equal(err.statusCode, 403);
          assert.match(err.message, /Only vendor owners can update store bank details and financial settings/i);
          return true;
        },
      );
    });

    it('allows VENDOR_OWNER to update bank details', async () => {
      const ownerActor = {
        id: 'owner-1',
        role: { name: ROLES.VENDOR_OWNER },
        vendorId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      } as any;

      mock.method(vendorsRepository, 'findById', async () => ({
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        businessName: 'Acme Store',
        status: 'ACTIVE',
        get: () => ({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', businessName: 'Acme Store' }),
      } as any));

      let updatedFields: any = null;
      mock.method(vendorsRepository, 'update', async (_id: string, patch: any) => {
        updatedFields = patch;
        return [1];
      });

      mock.method(AuditLog, 'create', async () => ({} as any));

      const res = await vendorsService.updateMyVendor(
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        {
          bankDetails: {
            accountHolderName: 'Valid Owner',
            accountNumber: '1111222233',
            ifscCode: 'SBIN0001234',
            bankName: 'SBI',
          },
        } as any,
        ownerActor,
      );

      assert.ok(res);
      assert.equal(updatedFields.bankDetails.accountHolderName, 'Valid Owner');
    });
  });

  describe('3. Coupon Authorization: requireVendorOwner Middleware', () => {
    it('blocks VENDOR_STAFF with 403 Forbidden', async () => {
      let passedError: any = null;
      let nextCalled = false;

      const req = {
        user: {
          id: 'staff-1',
          role: { name: ROLES.VENDOR_STAFF },
          vendorId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        },
      } as unknown as Request;

      requireVendorOwner(req, {} as Response, ((err?: unknown) => {
        passedError = err;
        nextCalled = true;
      }) as NextFunction);

      assert.equal(nextCalled, true);
      assert.ok(passedError instanceof ForbiddenError);
    });

    it('allows VENDOR_OWNER with vendorId to proceed', async () => {
      let passedError: any = null;
      let nextCalled = false;

      const req = {
        user: {
          id: 'owner-1',
          role: { name: ROLES.VENDOR_OWNER },
          vendorId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        },
      } as unknown as Request;

      requireVendorOwner(req, {} as Response, ((err?: unknown) => {
        passedError = err;
        nextCalled = true;
      }) as NextFunction);

      assert.equal(nextCalled, true);
      assert.equal(passedError, undefined);
    });

    it('allows SUPER_ADMIN to proceed', async () => {
      let passedError: any = null;
      let nextCalled = false;

      const req = {
        user: {
          id: 'admin-1',
          role: { name: ROLES.SUPER_ADMIN },
          vendorId: null,
        },
      } as unknown as Request;

      requireVendorOwner(req, {} as Response, ((err?: unknown) => {
        passedError = err;
        nextCalled = true;
      }) as NextFunction);

      assert.equal(nextCalled, true);
      assert.equal(passedError, undefined);
    });
  });

  describe('4. Dynamic RBAC in Ownership Middleware', () => {
    it('allows access to product if custom admin role has PRODUCT_MANAGE permission', async () => {
      setPermissionCache('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c11', [PERMISSIONS.PRODUCT_MANAGE]);

      const middleware = checkOwnership('product');
      let nextCalled = false;
      let errorThrown: any = null;

      const req = {
        params: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
        user: {
          id: 'custom-admin-1',
          roleId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c11',
          role: { name: 'CUSTOM_INVENTORY_MANAGER' },
          vendorId: null,
        },
      } as unknown as Request;

      await middleware(req, {} as Response, ((err?: unknown) => {
        errorThrown = err;
        nextCalled = true;
      }) as NextFunction);

      assert.equal(nextCalled, true);
      assert.equal(errorThrown, undefined);
    });

    it('rejects access to product if user lacks PRODUCT_MANAGE and does not own the product', async () => {
      setPermissionCache('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c22', []);
      mock.method(sequelize, 'query', async () => [
        { vendorId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380d11' },
      ]);

      const middleware = checkOwnership('product');
      let nextCalled = false;
      let errorThrown: any = null;

      const req = {
        params: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
        user: {
          id: 'vendor-owner-1',
          roleId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c22',
          role: { name: ROLES.VENDOR_OWNER },
          vendorId: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380e11',
        },
      } as unknown as Request;

      await middleware(req, {} as Response, ((err?: unknown) => {
        errorThrown = err;
        nextCalled = true;
      }) as NextFunction);

      assert.equal(nextCalled, true);
      assert.ok(errorThrown instanceof ForbiddenError);
    });
  });

  describe('5. Role Assignment & Vendor Binding', () => {
    it('binds vendorId when assigned VENDOR_STAFF role', async () => {
      const validTargetUserId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f01';
      const validRoleId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f02';
      const validVendorId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f03';
      let updatedUser: any = null;

      mock.method(usersRepository, 'findById', async () => ({
        id: validTargetUserId,
        name: 'Jane Doe',
        role: { name: ROLES.CUSTOMER },
        vendorId: null,
      } as any));

      mock.method(usersRepository, 'update', async (_id: string, patch: any) => {
        updatedUser = patch;
        return [1];
      });

      mock.method(Role, 'findByPk', async () => ({
        id: validRoleId,
        name: ROLES.VENDOR_STAFF,
      } as any));

      mock.method(authRepository, 'deleteRefreshTokensByUser', async () => 1);
      mock.method(AuditLog, 'create', async () => ({} as any));
      mock.method(usersService, 'getUserById', async () => ({ id: validTargetUserId } as any));

      const actor = { id: 'admin-1', role: { name: ROLES.SUPER_ADMIN } } as any;

      await usersService.updateUserRole(
        validTargetUserId,
        { roleId: validRoleId, vendorId: validVendorId },
        actor,
      );

      assert.ok(updatedUser);
      assert.equal(updatedUser.roleId, validRoleId);
      assert.equal(updatedUser.vendorId, validVendorId);
    });

    it('clears vendorId when transitioning from VENDOR_STAFF back to CUSTOMER', async () => {
      const validTargetUserId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f04';
      const validRoleId = 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f05';
      let updatedUser: any = null;

      mock.method(usersRepository, 'findById', async () => ({
        id: validTargetUserId,
        name: 'Former Staff',
        role: { name: ROLES.VENDOR_STAFF },
        vendorId: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380f06',
      } as any));

      mock.method(usersRepository, 'update', async (_id: string, patch: any) => {
        updatedUser = patch;
        return [1];
      });

      mock.method(Role, 'findByPk', async () => ({
        id: validRoleId,
        name: ROLES.CUSTOMER,
      } as any));

      mock.method(authRepository, 'deleteRefreshTokensByUser', async () => 1);
      mock.method(AuditLog, 'create', async () => ({} as any));
      mock.method(usersService, 'getUserById', async () => ({ id: validTargetUserId } as any));

      const actor = { id: 'admin-1', role: { name: ROLES.SUPER_ADMIN } } as any;

      await usersService.updateUserRole(
        validTargetUserId,
        { roleId: validRoleId },
        actor,
      );

      assert.ok(updatedUser);
      assert.equal(updatedUser.roleId, validRoleId);
      assert.equal(updatedUser.vendorId, null);
    });
  });

  describe('6. Delivery Agent Ratings Visibility', () => {
    it('returns rating metrics and recent feedback for delivery agent', async () => {
      mock.method(DeliveryRating, 'findAll', async (options: any) => {
        if (options?.attributes?.length === 1 && options.attributes[0] === 'rating') {
          return [{ rating: 5 }, { rating: 4 }, { rating: 5 }] as any;
        }
        return [
          { id: 'rate-1', rating: 5, comment: 'Fast delivery!', createdAt: new Date() },
          { id: 'rate-2', rating: 4, comment: 'Polite', createdAt: new Date() },
        ] as any;
      });

      const result = await deliveryAgentsService.myRatings('agent-123');
      assert.equal(result.averageRating, 4.7);
      assert.equal(result.ratingCount, 3);
      assert.equal(result.ratings.length, 2);
    });
  });

  describe('7. Customer Support Ticket Self-Closure', () => {
    it('allows ticket customer owner to close their own ticket', async () => {
      let updatedStatus: string | null = null;
      let closedAtSet = false;

      mock.method(SupportTicket, 'findByPk', async () => ({
        id: 'ticket-1',
        ticketNumber: 'TICK-0001',
        customerId: 'customer-me',
        status: SUPPORT_TICKET_STATUS.RESOLVED,
        update: async (patch: any) => {
          updatedStatus = patch.status;
          if (patch.closedAt) closedAtSet = true;
        },
        get: () => ({ id: 'ticket-1', status: updatedStatus }),
      } as any));

      mock.method(AuditLog, 'create', async () => ({} as any));

      const customerActor = {
        id: 'customer-me',
        role: { name: ROLES.CUSTOMER },
      } as any;

      const result = await supportTicketsService.close('ticket-1', customerActor);
      assert.equal(updatedStatus, SUPPORT_TICKET_STATUS.CLOSED);
      assert.equal(closedAtSet, true);
      assert.ok(result);
    });

    it('rejects self-closure with 403 if called by an unrelated customer', async () => {
      mock.method(SupportTicket, 'findByPk', async () => ({
        id: 'ticket-1',
        ticketNumber: 'TICK-0001',
        customerId: 'customer-other',
        status: SUPPORT_TICKET_STATUS.RESOLVED,
      } as any));

      const customerActor = {
        id: 'customer-stranger',
        role: { name: ROLES.CUSTOMER },
      } as any;

      await assert.rejects(
        async () => {
          await supportTicketsService.close('ticket-1', customerActor);
        },
        (err: AppError) => {
          assert.equal(err.statusCode, 403);
          return true;
        },
      );
    });
  });
});
