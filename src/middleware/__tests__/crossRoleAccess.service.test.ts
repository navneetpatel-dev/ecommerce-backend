import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Request, Response, NextFunction } from 'express';
import { payoutsService } from '@modules/payouts/payouts.service';
import { Payout } from '@database/models/payout.model';
import { vendorsService } from '@modules/vendors/vendors.service';
import { vendorsRepository } from '@modules/vendors/vendors.repository';
import { AuditLog } from '@database/models/auditLog.model';
import { requireVendorOwner } from '@modules/coupons/coupons.routes';
import { checkOwnership } from '@middleware/ownership.middleware';
import { sequelize as dbSequelize } from '@config/db';
import { sequelize } from '@database/models';
import { supportTicketsService } from '@modules/supportTickets/supportTickets.service';
import { SupportTicket } from '@database/models/supportTicket.model';
import { VendorCategory } from '@database/models/vendorCategory.model';
import { ROLES, SUPPORT_TICKET_STATUS } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { AppError } from '@core/errors/AppError';
import { setPermissionCache, clearPermissionCache } from '@middleware/rbac.middleware';

describe('access across roles', () => {
  beforeEach(() => {
    mock.method(sequelize, 'transaction', async (callback: (t: any) => Promise<any>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } } as any);
    });
    mock.method(dbSequelize, 'transaction', async (callback: (t: any) => Promise<any>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } } as any);
    });
  });

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

  describe('2. Financial: a vendor updates their own store', () => {
    it('lets the vendor update bank details', async () => {
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
      mock.method(VendorCategory, 'findAll', async () => []);

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
      );

      assert.ok(res);
      assert.equal(updatedFields.bankDetails.accountHolderName, 'Valid Owner');
    });
  });

  describe('3. Coupon Authorization: requireVendorOwner Middleware', () => {
    it('blocks a customer with 403 Forbidden', async () => {
      let passedError: any = null;
      const req = { user: { id: 'cust-1', role: { name: ROLES.CUSTOMER }, vendorId: null } } as unknown as Request;
      requireVendorOwner(req, {} as Response, ((err?: unknown) => {
        passedError = err;
      }) as NextFunction);
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

  describe('4. Permissions in the ownership middleware', () => {
    it('allows access to a product for someone holding PRODUCT_MANAGE', async () => {
      setPermissionCache('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c11', [PERMISSIONS.PRODUCT_MANAGE]);
      let errorThrown: any = null;
      const req = {
        params: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
        user: { id: 'admin-1', roleId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380c11', role: { name: ROLES.SUPER_ADMIN }, vendorId: null },
      } as unknown as Request;
      await checkOwnership('product')(req, {} as Response, ((err?: unknown) => {
        errorThrown = err;
      }) as NextFunction);
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

    it('rejects access to a sub-order of another store for a vendor', async () => {
      setPermissionCache('role-vendor-1', [PERMISSIONS.SUBORDER_MANAGE]);
      mock.method(sequelize, 'query', async () => [{ vendorId: 'vendor-xyz-1' }]);
      let errorThrown: any = null;
      const req = {
        params: { id: 'suborder-123' },
        user: { id: 'vendor-1', roleId: 'role-vendor-1', role: { name: ROLES.VENDOR_OWNER }, vendorId: 'vendor-abc-2' },
      } as unknown as Request;
      await checkOwnership('suborder')(req, {} as Response, ((err?: unknown) => {
        errorThrown = err;
      }) as NextFunction);
      assert.ok(errorThrown instanceof ForbiddenError);
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
