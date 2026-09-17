import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { sequelize } from '@database/models';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { Shipment } from '@database/models/shipment.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { DeliveryCashDeposit } from '@database/models/deliveryCashDeposit.model';
import { s3Client } from '@config/s3';
import { usersRepository } from '../users.repository';
import { authRepository } from '../../auth/auth.repository';
import { usersService } from '../users.service';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ROLES } from '@core/constants/statuses';

describe('UsersService.deleteOwnAccount', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  function stubTransaction() {
    mock.method(sequelize, 'transaction', async (callback: (t: unknown) => Promise<unknown>) => {
      return callback({ LOCK: { UPDATE: 'UPDATE' } });
    });
  }

  function stubDeleteSideEffects() {
    mock.method(authRepository, 'deleteRefreshTokensByUser', async () => undefined);
    mock.method(usersRepository, 'softDelete', async () => 1);
    // Allow-path runs cascadeDeleteEntityMedia after the guards. Isolate that
    // from live AWS so these tests assert the liability gate, not S3 credentials.
    if (s3Client) {
      mock.method(s3Client, 'send', async () => ({
        Contents: undefined,
        KeyCount: 0,
        IsTruncated: false,
      }));
    }
  }

  function stubUser(user: { id: string; vendorId?: string | null; role: { name: string } }) {
    mock.method(usersRepository, 'findById', async () => user as never);
  }

  it('rejects sole Super Admin self-delete and allows when another Super Admin exists', async () => {
    stubTransaction();
    stubUser({ id: 'sa-1', role: { name: ROLES.SUPER_ADMIN } });

    mock.method(sequelize, 'query', async () => [{ count: '0' }]);

    await assert.rejects(
      () => usersService.deleteOwnAccount('sa-1'),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /sole Super Administrator/);
        return true;
      },
    );

    mock.restoreAll();
    stubTransaction();
    stubUser({ id: 'sa-1', role: { name: ROLES.SUPER_ADMIN } });
    stubDeleteSideEffects();
    mock.method(sequelize, 'query', async () => [{ count: '1' }]);

    await usersService.deleteOwnAccount('sa-1');
  });

  it('rejects vendor owner with an active suborder and allows when only terminal suborders remain', async () => {
    stubTransaction();
    stubUser({ id: 'v-1', vendorId: 'vendor-1', role: { name: ROLES.VENDOR_OWNER } });
    mock.method(SubOrder, 'count', async () => 2);
    mock.method(CommissionLedger, 'count', async () => 0);

    await assert.rejects(
      () => usersService.deleteOwnAccount('v-1'),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /2 active suborders/);
        return true;
      },
    );

    mock.restoreAll();
    stubTransaction();
    stubUser({ id: 'v-1', vendorId: 'vendor-1', role: { name: ROLES.VENDOR_OWNER } });
    stubDeleteSideEffects();
    mock.method(SubOrder, 'count', async () => 0);
    mock.method(CommissionLedger, 'count', async () => 0);

    await usersService.deleteOwnAccount('v-1');
  });

  it('rejects delivery agent with an active shipment or unclosed cash shift, and allows when clear', async () => {
    stubTransaction();
    stubUser({ id: 'da-1', role: { name: ROLES.DELIVERY_AGENT } });
    mock.method(DeliveryAgent, 'findOne', async () => ({ id: 'agent-1', userId: 'da-1' }));
    mock.method(Shipment, 'count', async () => 3);
    mock.method(ReturnRequest, 'count', async () => 0);
    mock.method(Shipment, 'findAll', async () => []);
    mock.method(DeliveryCashDeposit, 'findAll', async () => []);

    await assert.rejects(
      () => usersService.deleteOwnAccount('da-1'),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /3 active shipments/);
        return true;
      },
    );

    mock.restoreAll();
    stubTransaction();
    stubUser({ id: 'da-1', role: { name: ROLES.DELIVERY_AGENT } });
    mock.method(DeliveryAgent, 'findOne', async () => ({ id: 'agent-1', userId: 'da-1' }));
    mock.method(Shipment, 'count', async () => 0);
    mock.method(ReturnRequest, 'count', async () => 0);
    mock.method(Shipment, 'findAll', async () => [{ codAmount: 500 }]);
    mock.method(DeliveryCashDeposit, 'findAll', async () => []);

    await assert.rejects(
      () => usersService.deleteOwnAccount('da-1'),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /undeposited COD cash/);
        return true;
      },
    );

    mock.restoreAll();
    stubTransaction();
    stubUser({ id: 'da-1', role: { name: ROLES.DELIVERY_AGENT } });
    stubDeleteSideEffects();
    mock.method(DeliveryAgent, 'findOne', async () => ({ id: 'agent-1', userId: 'da-1' }));
    mock.method(Shipment, 'count', async () => 0);
    mock.method(ReturnRequest, 'count', async () => 0);
    mock.method(Shipment, 'findAll', async () => [{ codAmount: 500 }]);
    mock.method(DeliveryCashDeposit, 'findAll', async () => [{ amount: 500 }]);

    await usersService.deleteOwnAccount('da-1');
  });

  it('rejects a customer with a PENDING order and allows when only DELIVERED orders remain', async () => {
    stubTransaction();
    stubUser({ id: 'c-1', role: { name: ROLES.CUSTOMER } });
    mock.method(Order, 'count', async () => 1);

    await assert.rejects(
      () => usersService.deleteOwnAccount('c-1'),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenError);
        assert.match(err.message, /1 active orders/);
        return true;
      },
    );

    mock.restoreAll();
    stubTransaction();
    stubUser({ id: 'c-1', role: { name: ROLES.CUSTOMER } });
    stubDeleteSideEffects();
    mock.method(Order, 'count', async () => 0);

    await usersService.deleteOwnAccount('c-1');
  });

  it('allows self-delete for customer, vendor, agent, and admin with zero liabilities', async () => {
    stubTransaction();
    stubDeleteSideEffects();

    stubUser({ id: 'c-clear', role: { name: ROLES.CUSTOMER } });
    mock.method(Order, 'count', async () => 0);
    await usersService.deleteOwnAccount('c-clear');

    stubUser({ id: 'v-clear', vendorId: 'vendor-clear', role: { name: ROLES.VENDOR_STAFF } });
    mock.method(SubOrder, 'count', async () => 0);
    mock.method(CommissionLedger, 'count', async () => 0);
    await usersService.deleteOwnAccount('v-clear');

    stubUser({ id: 'da-clear', role: { name: ROLES.DELIVERY_AGENT } });
    mock.method(DeliveryAgent, 'findOne', async () => ({ id: 'agent-clear', userId: 'da-clear' }));
    mock.method(Shipment, 'count', async () => 0);
    mock.method(ReturnRequest, 'count', async () => 0);
    mock.method(Shipment, 'findAll', async () => []);
    mock.method(DeliveryCashDeposit, 'findAll', async () => []);
    await usersService.deleteOwnAccount('da-clear');

    stubUser({ id: 'admin-clear', role: { name: ROLES.ADMIN_ORDER_MANAGER } });
    await usersService.deleteOwnAccount('admin-clear');
  });
});
