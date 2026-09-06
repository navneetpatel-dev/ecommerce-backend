import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { User } from '@database/models/user.model';
import { AuditLog } from '@database/models/auditLog.model';
import { loadUserFromBearer } from '@middleware/auth.middleware';
import {
  requestContextStorage,
  getRequestContext,
  setImpersonatedBy,
} from '@core/context/requestContext';
import { logAudit } from '@modules/audit/audit.service';

function signToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30m' });
}

describe('requestContext + impersonation attribution', () => {
  afterEach(() => mock.restoreAll());

  it('setImpersonatedBy is only visible inside the same AsyncLocalStorage run', () => {
    assert.equal(getRequestContext(), undefined);

    requestContextStorage.run({ requestId: 'r1' }, () => {
      assert.equal(getRequestContext()?.impersonatedBy, undefined);
      setImpersonatedBy('admin-1');
      assert.equal(getRequestContext()?.impersonatedBy, 'admin-1');
    });

    assert.equal(getRequestContext(), undefined);
  });

  it('logAudit merges impersonatedBy from context into metadata when present', async () => {
    let createdWith: any;
    mock.method(AuditLog, 'create', async (data: any) => {
      createdWith = data;
      return data;
    });

    await requestContextStorage.run({ requestId: 'r2', impersonatedBy: 'admin-9' }, () =>
      logAudit({
        actorId: 'customer-1',
        action: 'TEST_ACTION',
        entityType: 'Order',
        entityId: 'order-1',
      }),
    );

    assert.equal(createdWith.metadata.impersonatedBy, 'admin-9');
  });

  it('logAudit leaves metadata untouched outside an impersonated context', async () => {
    let createdWith: any;
    mock.method(AuditLog, 'create', async (data: any) => {
      createdWith = data;
      return data;
    });

    await requestContextStorage.run({ requestId: 'r3' }, () =>
      logAudit({
        actorId: 'admin-1',
        action: 'TEST_ACTION',
        entityType: 'Order',
        entityId: 'order-2',
      }),
    );

    assert.equal(createdWith.metadata.impersonatedBy, undefined);
  });

  it('a token carrying impersonatedBy resolves req.user.impersonatedBy correctly', async () => {
    mock.method(User, 'findByPk', async () => ({ status: 'ACTIVE' }));

    const token = signToken({
      sub: 'target-user-1',
      email: 'target@example.com',
      roleId: 'role-1',
      vendorId: null,
      deliveryAgentId: null,
      roleName: 'CUSTOMER',
      impersonatedBy: 'admin-1',
    });

    const result = await loadUserFromBearer(`Bearer ${token}`);
    assert.equal('user' in result, true);
    assert.equal((result as any).user.impersonatedBy, 'admin-1');
  });

  it('a normal (non-impersonated) token resolves impersonatedBy to null', async () => {
    mock.method(User, 'findByPk', async () => ({ status: 'ACTIVE' }));

    const token = signToken({
      sub: 'user-1',
      email: 'user@example.com',
      roleId: 'role-1',
      vendorId: null,
      deliveryAgentId: null,
      roleName: 'CUSTOMER',
    });

    const result = await loadUserFromBearer(`Bearer ${token}`);
    assert.equal('user' in result, true);
    assert.equal((result as any).user.impersonatedBy, null);
  });
});
