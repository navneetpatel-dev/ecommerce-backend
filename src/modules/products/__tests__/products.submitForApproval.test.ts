import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { AuditLog } from '@database/models/auditLog.model';
import { ProductCategory } from '@database/models/productCategory.model';
import { ProductImage } from '@database/models/productImage.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { User } from '@database/models/user.model';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { settingsService } from '@modules/settings/settings.service';
import { vendorsService } from '@modules/vendors/vendors.service';
import { productsRepository } from '../products.repository';
import { productsService } from '../products.service';

describe('ProductsService.submitForApproval', () => {
  let updates: Array<Record<string, unknown>>;
  let audits: Array<Record<string, unknown>>;

  beforeEach(() => {
    updates = [];
    audits = [];
    mock.method(sequelize, 'transaction', async (callback: (t: object) => Promise<unknown>) => callback({}));
    mock.method(productsRepository, 'findById', async () => ({ id: 'p1', vendorId: 'v1', status: PRODUCT_STATUS.DRAFT, categoryId: 'c1', name: 'Lamp' }) as never);
    mock.method(ProductVariant, 'count', async () => 1 as never);
    mock.method(ProductImage, 'count', async () => 1 as never);
    mock.method(ProductCategory, 'findAll', async () => [] as never);
    mock.method(vendorsService, 'assertCategoriesKycSatisfied', async () => undefined);
    mock.method(productsRepository, 'update', async (_id: string, fields: Record<string, unknown>) => {
      updates.push(fields);
      return undefined as never;
    });
    mock.method(productsService, 'getProductById', async () => ({ id: 'p1', vendorId: 'v1', name: 'Lamp' }) as never);
    mock.method(User, 'findAll', async () => [] as never);
    mock.method(AuditLog, 'create', async (row: Record<string, unknown>) => {
      audits.push(row);
      return {} as never;
    });
  });

  afterEach(() => mock.restoreAll());

  const withSetting = (autoApproveProducts: boolean) =>
    mock.method(settingsService, 'getPlatformSettings', async () => ({ autoApproveProducts }) as never);

  it('queues the product for moderation when auto-approve is off', async () => {
    withSetting(false);
    await productsService.submitForApproval('p1', 'v1', 'user-1');
    assert.equal(updates[0]?.status, PRODUCT_STATUS.PENDING_APPROVAL);
    assert.equal(audits.length, 0);
  });

  it('publishes straight away and audits it when auto-approve is on', async () => {
    withSetting(true);
    await productsService.submitForApproval('p1', 'v1', 'user-1');
    assert.equal(updates[0]?.status, PRODUCT_STATUS.LIVE);
    assert.equal(updates[0]?.approvedById, null);
    assert.equal(audits[0]?.action, 'PRODUCT_AUTO_APPROVED');
    assert.equal(audits[0]?.actorId, 'user-1');
  });
});
