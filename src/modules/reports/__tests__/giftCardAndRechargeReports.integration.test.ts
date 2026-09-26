/**
 * Gift-card purchases and wallet recharges are Razorpay payments too: the gateway
 * reconciliation lists them beside orders, and the gift-card report shows what was
 * sold, redeemed, expired and is still owed. Skips when Postgres is unreachable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sequelize } from '@database/models';
import { GiftCard } from '@database/models/giftCard.model';
import { Role } from '@database/models/role.model';
import { User } from '@database/models/user.model';
import { WalletRechargeOrder } from '@database/models/walletRechargeOrder.model';
import { GIFT_CARD_STATUS, ROLES } from '@core/constants/statuses';
import { getReportDefinition } from '@modules/reports/engine/reportRegistry';
import { ensureTestRoles } from '../../../testHelpers/ensureTestRoles';

const DAY_MS = 24 * 60 * 60 * 1000;
let dbReady = false;
let userId = '';
const giftCardIds: string[] = [];
const rechargeIds: string[] = [];

async function dbAvailable(): Promise<boolean> {
  try {
    await Promise.race([
      sequelize.authenticate(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

describe('gift card and wallet recharge reports', () => {
  const now = new Date();
  const range = { from: new Date(now.getTime() - DAY_MS), to: new Date(now.getTime() + DAY_MS) };
  let liabilityBefore = new Map<string, { cardCount: number; amount: number }>();

  const liability = async () => {
    const report = await getReportDefinition('gift-card-liability')!.query({ ...range } as never);
    return new Map(
      (report.rows as Array<{ line: string; cardCount: number; amount: number }>).map((row) => [
        row.line,
        { cardCount: row.cardCount, amount: row.amount },
      ]),
    );
  };

  before(async () => {
    dbReady = await dbAvailable();
    if (!dbReady) return;
    await ensureTestRoles();
    liabilityBefore = await liability();
    const role = await Role.findOne({ where: { name: ROLES.CUSTOMER } });
    const user = await User.create({
      name: 'Gift Card Report Customer',
      email: `gift-report-${randomUUID()}@example.com`,
      passwordHash: 'x',
      roleId: role!.id,
      status: 'ACTIVE',
      phone: null,
      vendorId: null,
      avatarUrl: null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    });
    userId = user.id;
    const card = (status: string, amount: number, extra: Record<string, unknown> = {}) =>
      GiftCard.create({
        code: `T${randomUUID().replace(/-/g, '').slice(0, 15).toUpperCase()}`,
        amount,
        purchaserId: userId,
        recipientEmail: 'friend@example.com',
        recipientName: null,
        message: null,
        redeemedByUserId: null,
        redeemedAt: null,
        expiresAt: new Date(now.getTime() + 365 * DAY_MS),
        status: status as never,
        razorpayOrderId: `order_${randomUUID().slice(0, 8)}`,
        razorpayPaymentId: status === GIFT_CARD_STATUS.PENDING ? null : `pay_${randomUUID().slice(0, 8)}`,
        createdBy: userId,
        updatedBy: null,
        deletedBy: null,
        ...extra,
      });
    giftCardIds.push(
      (await card(GIFT_CARD_STATUS.ACTIVE, 1000)).id,
      (await card(GIFT_CARD_STATUS.REDEEMED, 500, { redeemedAt: now, redeemedByUserId: userId })).id,
      (await card(GIFT_CARD_STATUS.PENDING, 700)).id,
    );
    const recharge = (extra: Record<string, unknown>) =>
      WalletRechargeOrder.create({
        userId,
        amountInr: 2000,
        pointsCredited: 2000,
        razorpayOrderId: `order_${randomUUID().slice(0, 8)}`,
        razorpayPaymentId: `pay_${randomUUID().slice(0, 8)}`,
        status: 'PAID',
        paidAt: now,
        ...extra,
      } as never);
    rechargeIds.push(
      (await recharge({})).id,
      (await recharge({ refundStatus: 'COMPLETED', razorpayRefundId: 'rfnd_x' })).id,
    );
  });

  after(async () => {
    if (!dbReady) return;
    await GiftCard.destroy({ where: { id: giftCardIds }, force: true });
    await WalletRechargeOrder.destroy({ where: { id: rechargeIds }, force: true });
    await User.destroy({ where: { id: userId }, force: true });
  });

  it('lists gift-card purchases and wallet recharges in the gateway reconciliation', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const report = await getReportDefinition('payment-gateway-reconciliation')!.query({
      ...range,
      page: 1,
      limit: 500,
    } as never);
    const rows = report.rows as Array<Record<string, unknown>>;
    const byId = new Map(rows.map((row) => [row.orderId, row]));

    const active = byId.get(giftCardIds[0]);
    assert.equal(active?.sourceType, 'GIFT_CARD');
    assert.equal(active?.captured, 1000);
    assert.equal(active?.reconStatus, 'MATCHED');
    const pending = byId.get(giftCardIds[2]);
    assert.equal(pending?.captured, 0);
    assert.equal(pending?.reconStatus, 'PENDING');

    const kept = byId.get(rechargeIds[0]);
    assert.equal(kept?.sourceType, 'WALLET_RECHARGE');
    assert.deepEqual([kept?.captured, kept?.refunded, kept?.net], [2000, 0, 2000]);
    const refunded = byId.get(rechargeIds[1]);
    assert.deepEqual([refunded?.captured, refunded?.refunded, refunded?.net], [2000, 2000, 0]);
    assert.equal(refunded?.reconStatus, 'REFUNDED');
  });

  it('reports gift cards sold, redeemed and still owed', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const after = await liability();
    const delta = (line: string) => ({
      cardCount: after.get(line)!.cardCount - (liabilityBefore.get(line)?.cardCount ?? 0),
      amount: after.get(line)!.amount - (liabilityBefore.get(line)?.amount ?? 0),
    });
    // The unpaid (PENDING) card is not sold.
    assert.deepEqual(delta('SOLD'), { cardCount: 2, amount: 1500 });
    assert.deepEqual(delta('REDEEMED'), { cardCount: 1, amount: 500 });
    // Owed at the end of the period: the paid card nobody has redeemed yet.
    assert.deepEqual(delta('OUTSTANDING_AT_END'), { cardCount: 1, amount: 1000 });
  });
});
