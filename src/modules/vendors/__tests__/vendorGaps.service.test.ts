import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Request, Response, NextFunction } from 'express';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { AuditLog } from '@database/models/auditLog.model';
import { ProductImage } from '@database/models/productImage.model';
import { ProductCategory } from '@database/models/productCategory.model';
import { sequelize } from '@database/models';
import { sequelize as dbSequelize } from '@config/db';
import { checkProductVariantOwnership } from '@middleware/ownership.middleware';
import { subordersService } from '@modules/suborders/suborders.service';
import { payoutsService } from '@modules/payouts/payouts.service';
import { vendorsService } from '../vendors.service';
import { vendorsRepository } from '../vendors.repository';
import { productsService } from '@modules/products/products.service';
import { productsRepository } from '@modules/products/products.repository';
import { settingsService } from '@modules/settings/settings.service';
import { walletService } from '@modules/wallet/wallet.service';
import { notificationsService } from '@modules/notifications/notifications.service';
import {
  ORDER_STATUS,
  COMMISSION_STATUS,
  PAYMENT_STATUS,
  VENDOR_STATUS,
  PRODUCT_STATUS,
  ROLES,
} from '@core/constants/statuses';

describe('Vendor Modules Gap Fixes Verification', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  describe('1. checkProductVariantOwnership Middleware', () => {
    it('passes through if user is superadmin / catalog admin', async () => {
      const middleware = checkProductVariantOwnership();
      let nextCalled = false;
      const req = {
        params: { variantId: '11111111-1111-1111-1111-111111111111' },
        user: { id: 'u-1', role: { name: ROLES.SUPER_ADMIN } },
      } as unknown as Request;

      await middleware(req, {} as Response, ((err?: unknown) => {
        assert.equal(err, undefined);
        nextCalled = true;
      }) as NextFunction);

      assert.equal(nextCalled, true);
    });

    it('returns 404 when variant does not exist', async () => {
      const middleware = checkProductVariantOwnership();
      mock.method(dbSequelize, 'query', async () => []);

      const req = {
        params: { variantId: '11111111-1111-1111-1111-111111111111' },
        user: { id: 'u-1', vendorId: 'vendor-1', role: { name: ROLES.SELLER } },
      } as unknown as Request;

      let caughtErr: any;
      await middleware(req, {} as Response, ((err?: unknown) => {
        caughtErr = err;
      }) as NextFunction);

      assert.ok(caughtErr);
      assert.equal(caughtErr.statusCode, 404);
    });

    it('returns 403 when variant belongs to a different vendor', async () => {
      const middleware = checkProductVariantOwnership();
      mock.method(dbSequelize, 'query', async () => [{ vendorId: 'vendor-attacker' }]);

      const req = {
        params: { variantId: '11111111-1111-1111-1111-111111111111' },
        user: { id: 'u-1', vendorId: 'vendor-victim', role: { name: ROLES.SELLER } },
      } as unknown as Request;

      let caughtErr: any;
      await middleware(req, {} as Response, ((err?: unknown) => {
        caughtErr = err;
      }) as NextFunction);

      assert.ok(caughtErr);
      assert.equal(caughtErr.statusCode, 403);
    });

    it('calls next() when variant belongs to the requesting vendor', async () => {
      const middleware = checkProductVariantOwnership();
      mock.method(dbSequelize, 'query', async () => [{ vendorId: 'vendor-owner' }]);

      const req = {
        params: { variantId: '11111111-1111-1111-1111-111111111111' },
        user: { id: 'u-1', vendorId: 'vendor-owner', role: { name: ROLES.SELLER } },
      } as unknown as Request;

      let nextCalled = false;
      await middleware(req, {} as Response, ((err?: unknown) => {
        assert.equal(err, undefined);
        nextCalled = true;
      }) as NextFunction);

      assert.equal(nextCalled, true);
    });
  });

  describe('2. SubOrder Cancellation Cascade', () => {
    it('restocks items, destroys pending ledgers, refunds wallet, and cascades to parent order', async () => {
      mock.method(sequelize, 'transaction', async (callback: (t: any) => Promise<any>) => {
        return callback({ LOCK: { UPDATE: 'UPDATE' } });
      });

      let updatedFields: any = null;
      const mockSubOrder = {
        id: '22222222-2222-2222-2222-222222222222',
        orderId: '33333333-3333-3333-3333-333333333333',
        vendorId: 'vendor-1',
        status: ORDER_STATUS.CONFIRMED,
        subtotal: 500,
        customerTotal: 500,
        update: async (fields: any) => {
          updatedFields = fields;
        },
        reload: async () => mockSubOrder,
      };

      mock.method(SubOrder, 'findByPk', async (_id: string, options?: any) => {
        if (options?.include) {
          return {
            ...mockSubOrder,
            items: [
              { variantId: 'var-1', quantity: 2 },
              { variantId: 'var-2', quantity: 1 },
            ],
            order: { id: '33333333-3333-3333-3333-333333333333', userId: 'user-123' },
          } as unknown as SubOrder;
        }
        return mockSubOrder as unknown as SubOrder;
      });

      let stockIncrements: Array<{ id: string; by: number }> = [];
      mock.method(ProductVariant, 'increment', async (_field: string, options: any) => {
        stockIncrements.push({ id: options.where.id, by: options.by });
      });

      let destroyedLedgers: Array<{ model: string; where: any }> = [];
      mock.method(CommissionLedger, 'destroy', async (options: any) => {
        destroyedLedgers.push({ model: 'CommissionLedger', where: options.where });
        return 1;
      });
      mock.method(TcsLedger, 'destroy', async (options: any) => {
        destroyedLedgers.push({ model: 'TcsLedger', where: options.where });
        return 1;
      });

      let walletCreditCalled = false;
      let walletAmount = 0;
      mock.method(walletService, 'credit', async (_userId: string, amount: number) => {
        walletCreditCalled = true;
        walletAmount = amount;
        return {} as any;
      });

      mock.method(Order, 'findByPk', async () => ({
        id: '33333333-3333-3333-3333-333333333333',
        userId: 'user-123',
        paymentStatus: PAYMENT_STATUS.PAID,
        status: ORDER_STATUS.CONFIRMED,
      }) as unknown as Order);

      mock.method(SubOrder, 'findAll', async () => [
        { id: '22222222-2222-2222-2222-222222222222', status: ORDER_STATUS.CANCELLED },
      ] as unknown as SubOrder[]);

      let orderUpdatedStatus = '';
      mock.method(Order, 'update', async (fields: any) => {
        orderUpdatedStatus = fields.status;
        return [1];
      });

      mock.method(notificationsService, 'sendOrderCancelled', () => {});

      await subordersService.updateStatus(
        '22222222-2222-2222-2222-222222222222',
        ORDER_STATUS.CANCELLED,
        undefined,
        'actor-1',
      );

      // Assertions
      assert.equal(updatedFields?.status, ORDER_STATUS.CANCELLED);
      assert.equal(stockIncrements.length, 2);
      assert.deepEqual(stockIncrements[0], { id: 'var-1', by: 2 });
      assert.deepEqual(stockIncrements[1], { id: 'var-2', by: 1 });

      assert.equal(destroyedLedgers.length, 2);
      assert.equal(destroyedLedgers[0].model, 'CommissionLedger');
      assert.equal(destroyedLedgers[0].where.status, COMMISSION_STATUS.PENDING);
      assert.equal(destroyedLedgers[1].model, 'TcsLedger');

      assert.equal(walletCreditCalled, true);
      assert.equal(walletAmount, 500);

      assert.equal(orderUpdatedStatus, ORDER_STATUS.CANCELLED);
    });
  });

  describe('3. Payout Processing Only For DELIVERED SubOrders', () => {
    it('queries CommissionLedger with SubOrder status DELIVERED filter', async () => {
      mock.method(settingsService, 'getPlatformSettings', async () => ({
        tdsRatePercent: 1,
      }) as any);

      let capturedInclude: any = null;
      mock.method(CommissionLedger, 'findAll', async (options: any) => {
        capturedInclude = options?.include;
        return [];
      });

      const result = await payoutsService.process('actor-1');

      assert.ok(capturedInclude);
      const subOrderInclude = capturedInclude.find((inc: any) => inc.model === SubOrder);
      assert.ok(subOrderInclude, 'Must include SubOrder model');
      assert.equal(subOrderInclude.where?.status, ORDER_STATUS.DELIVERED);
      assert.equal(subOrderInclude.required, true);
      assert.deepEqual(result, []);
    });
  });

  describe('4. Vendor Unsuspend Workflow', () => {
    it('restores SUSPENDED vendor to APPROVED and clears suspensionReason', async () => {
      mock.method(sequelize, 'transaction', async (callback: (t: any) => Promise<any>) => {
        return callback({});
      });

      const vendorId = '00000000-0000-0000-0000-000000000002';
      const adminId = '00000000-0000-0000-0000-000000000001';

      mock.method(vendorsRepository, 'findById', async () => ({
        id: vendorId,
        status: VENDOR_STATUS.SUSPENDED,
        businessName: 'Store 1',
      }) as any);

      let repoUpdatedFields: any = null;
      mock.method(vendorsRepository, 'update', async (_id: string, fields: any) => {
        repoUpdatedFields = fields;
        return [1];
      });

      mock.method(vendorsService, 'getVendorById', async () => ({
        id: vendorId,
        status: VENDOR_STATUS.APPROVED,
        businessName: 'Store 1',
      }) as any);

      mock.method(AuditLog, 'create', async () => ({} as any));
      mock.method(notificationsService, 'sendVendorApproved', () => {});

      const res = await vendorsService.unsuspendVendor(vendorId, adminId);

      assert.equal(res.status, VENDOR_STATUS.APPROVED);
      assert.equal(repoUpdatedFields?.status, VENDOR_STATUS.APPROVED);
      assert.equal(repoUpdatedFields?.suspensionReason, null);
    });

    it('rejects unsuspend if vendor is not in SUSPENDED state', async () => {
      mock.method(sequelize, 'transaction', async (callback: (t: any) => Promise<any>) => {
        return callback({});
      });

      mock.method(vendorsRepository, 'findById', async () => ({
        id: 'vendor-2',
        status: VENDOR_STATUS.APPROVED,
      }) as any);

      await assert.rejects(
        async () => vendorsService.unsuspendVendor('vendor-2', 'admin-1'),
        /Only suspended vendors can be unsuspended/,
      );
    });
  });

  describe('5. Product Draft Submission Quality Gate', () => {
    it('rejects draft submission if product has 0 variants', async () => {
      mock.method(sequelize, 'transaction', async (callback: (t: any) => Promise<any>) => {
        return callback({});
      });

      mock.method(productsRepository, 'findById', async () => ({
        id: '44444444-4444-4444-4444-444444444444',
        vendorId: 'vendor-1',
        status: PRODUCT_STATUS.DRAFT,
      }) as unknown as Product);

      mock.method(ProductVariant, 'count', async () => 0);
      mock.method(ProductImage, 'count', async () => 1);

      await assert.rejects(
        async () => productsService.submitForApproval('44444444-4444-4444-4444-444444444444', 'vendor-1'),
        /Cannot submit product for approval without at least one variant/,
      );
    });

    it('rejects draft submission if product has 0 images', async () => {
      mock.method(sequelize, 'transaction', async (callback: (t: any) => Promise<any>) => {
        return callback({});
      });

      mock.method(productsRepository, 'findById', async () => ({
        id: '44444444-4444-4444-4444-444444444444',
        vendorId: 'vendor-1',
        status: PRODUCT_STATUS.DRAFT,
      }) as unknown as Product);

      mock.method(ProductVariant, 'count', async () => 1);
      mock.method(ProductImage, 'count', async () => 0);

      await assert.rejects(
        async () => productsService.submitForApproval('44444444-4444-4444-4444-444444444444', 'vendor-1'),
        /Cannot submit product for approval without at least one image/,
      );
    });

    it('submits successfully when product has at least 1 variant and 1 image', async () => {
      mock.method(sequelize, 'transaction', async (callback: (t: any) => Promise<any>) => {
        return callback({});
      });

      mock.method(productsRepository, 'findById', async () => ({
        id: '44444444-4444-4444-4444-444444444444',
        vendorId: 'vendor-1',
        categoryId: 'cat-1',
        status: PRODUCT_STATUS.DRAFT,
      }) as unknown as Product);

      mock.method(ProductVariant, 'count', async () => 2);
      mock.method(ProductImage, 'count', async () => 3);
      mock.method(ProductCategory, 'findAll', async () => []);
      mock.method(vendorsService, 'assertCategoriesKycSatisfied', async () => {});

      let updatedFields: any = null;
      mock.method(productsRepository, 'update', async (_id: string, fields: any) => {
        updatedFields = fields;
        return [1];
      });

      mock.method(productsService, 'getProductById', async (id: string) => ({
        id,
        status: PRODUCT_STATUS.PENDING_APPROVAL,
      }) as any);

      const res = await productsService.submitForApproval('44444444-4444-4444-4444-444444444444', 'vendor-1');

      assert.equal(updatedFields?.status, PRODUCT_STATUS.PENDING_APPROVAL);
      assert.equal((res as any)?.status, PRODUCT_STATUS.PENDING_APPROVAL);
    });
  });
});
