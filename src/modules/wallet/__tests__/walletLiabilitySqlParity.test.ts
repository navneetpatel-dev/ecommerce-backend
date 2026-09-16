/**
 * Cross-validates TS getPointSourceBalances() against the SQL FIFO allocation
 * used by the admin wallet-liability report. A mismatch is a real finding —
 * do not "fix" the test to match whichever answer came first.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sequelize } from '@database/models';
import { Role } from '@database/models/role.model';
import { User } from '@database/models/user.model';
import { WalletLedger } from '@database/models/walletLedger.model';
import {
  ROLES,
  WALLET_LEDGER_TYPE,
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
} from '@core/constants/statuses';
import { roundMoney } from '@modules/pricing/money';
import { walletLiabilitySelectSql } from '@modules/reports/definitions/legacyPanelReports';
import { getPointSourceBalances } from '../walletBalances';
import { ensureTestRoles } from '../../../testHelpers/ensureTestRoles';

let dbReady = false;
const cleanupUserIds: string[] = [];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function createCustomer(): Promise<User> {
  const role = await Role.findOne({ where: { name: ROLES.CUSTOMER } });
  if (!role) throw new Error('Missing CUSTOMER role');
  const user = await User.create({
    name: 'Wallet Parity Customer',
    email: `wallet-parity-${randomUUID()}@example.com`,
    passwordHash: 'x',
    roleId: role.id,
    status: 'ACTIVE',
    phone: null,
    vendorId: null,
    avatarUrl: null,
    createdBy: null,
    updatedBy: null,
    deletedBy: null,
  });
  cleanupUserIds.push(user.id);
  return user;
}

type LedgerSeed = {
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  pointSource?: 'PURCHASED' | 'PROMOTIONAL' | null;
  pointSourceBreakdown?: { promotional?: number; purchased?: number } | null;
  at: Date;
};

async function seedLedger(userId: string, rows: LedgerSeed[]): Promise<void> {
  let balance = 0;
  for (const row of rows) {
    if (row.type === 'CREDIT') balance = roundMoney(balance + row.amount);
    else balance = roundMoney(balance - row.amount);
    await WalletLedger.create({
      userId,
      type: row.type,
      amount: row.amount,
      balanceAfter: Math.max(0, balance),
      referenceType: WALLET_REFERENCE_TYPE.ADMIN_ADJUSTMENT,
      referenceId: randomUUID(),
      description: 'parity-test',
      pointSource: row.pointSource ?? null,
      expiresAt: null,
      pointSourceBreakdown: row.pointSourceBreakdown ?? null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
      createdAt: row.at,
      updatedAt: row.at,
    });
  }
}

async function sqlSplitForUser(userId: string): Promise<{
  purchased: number;
  promotional: number;
  total: number;
} | null> {
  const from = new Date('2020-01-01T00:00:00.000Z');
  const to = new Date('2030-01-01T00:00:00.000Z');
  const [rows] = (await sequelize.query(`${walletLiabilitySelectSql()}`, {
    replacements: { from, to },
  })) as [
    Array<{
      userId: string;
      balance: number;
      purchasedPoints: number;
      promotionalPoints: number;
    }>,
    unknown,
  ];
  const row = rows.find((r) => r.userId === userId);
  if (!row) return null;
  return {
    purchased: roundMoney(Number(row.purchasedPoints ?? 0)),
    promotional: roundMoney(Number(row.promotionalPoints ?? 0)),
    total: roundMoney(Number(row.balance ?? 0)),
  };
}

function t(day: number): Date {
  return new Date(Date.UTC(2024, 0, day, 12, 0, 0));
}

describe('wallet liability TS vs SQL parity', () => {
  before(async () => {
    try {
      await withTimeout(sequelize.authenticate(), 2000);
      await ensureTestRoles();
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  after(async () => {
    if (dbReady) {
      try {
        for (const userId of cleanupUserIds) {
          await WalletLedger.destroy({ where: { userId }, force: true });
          await User.destroy({ where: { id: userId }, force: true });
        }
      } catch {
        /* best-effort cleanup */
      }
    }
    try {
      await sequelize.close();
    } catch {
      /* ignore */
    }
  });

  it('purchased credits only, no debits', async (test) => {
    if (!dbReady) return test.skip('database unavailable');
    const user = await createCustomer();
    await seedLedger(user.id, [
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 200, pointSource: WALLET_POINT_SOURCE.PURCHASED, at: t(1) },
    ]);
    const ts = await getPointSourceBalances(user.id);
    const sql = await sqlSplitForUser(user.id);
    assert.ok(sql);
    assert.equal(ts.purchased, sql.purchased);
    assert.equal(ts.promotional, sql.promotional);
    assert.equal(ts.purchased, 200);
    assert.equal(ts.promotional, 0);
  });

  it('promotional credits only, no debits', async (test) => {
    if (!dbReady) return test.skip('database unavailable');
    const user = await createCustomer();
    await seedLedger(user.id, [
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 75, pointSource: WALLET_POINT_SOURCE.PROMOTIONAL, at: t(1) },
    ]);
    const ts = await getPointSourceBalances(user.id);
    const sql = await sqlSplitForUser(user.id);
    assert.ok(sql);
    assert.equal(ts.purchased, sql.purchased);
    assert.equal(ts.promotional, sql.promotional);
    assert.equal(ts.purchased, 0);
    assert.equal(ts.promotional, 75);
  });

  it('mixed credits and a legacy debit smaller than the promotional pool', async (test) => {
    if (!dbReady) return test.skip('database unavailable');
    const user = await createCustomer();
    await seedLedger(user.id, [
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 100, pointSource: WALLET_POINT_SOURCE.PURCHASED, at: t(1) },
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 80, pointSource: WALLET_POINT_SOURCE.PROMOTIONAL, at: t(2) },
      { type: WALLET_LEDGER_TYPE.DEBIT, amount: 30, at: t(3) },
    ]);
    const ts = await getPointSourceBalances(user.id);
    const sql = await sqlSplitForUser(user.id);
    assert.ok(sql);
    assert.equal(ts.purchased, sql.purchased);
    assert.equal(ts.promotional, sql.promotional);
    assert.equal(ts.purchased, 100);
    assert.equal(ts.promotional, 50);
  });

  it('legacy debit larger than promotional-at-debit (spillover into purchased)', async (test) => {
    if (!dbReady) return test.skip('database unavailable');
    const user = await createCustomer();
    await seedLedger(user.id, [
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 100, pointSource: WALLET_POINT_SOURCE.PURCHASED, at: t(1) },
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 20, pointSource: WALLET_POINT_SOURCE.PROMOTIONAL, at: t(2) },
      { type: WALLET_LEDGER_TYPE.DEBIT, amount: 50, at: t(3) },
    ]);
    const ts = await getPointSourceBalances(user.id);
    const sql = await sqlSplitForUser(user.id);
    assert.ok(sql);
    assert.equal(ts.purchased, sql.purchased);
    assert.equal(ts.promotional, sql.promotional);
    assert.equal(ts.purchased, 70);
    assert.equal(ts.promotional, 0);
  });

  it('explicit pointSourceBreakdown on a debit bypasses FIFO', async (test) => {
    if (!dbReady) return test.skip('database unavailable');
    const user = await createCustomer();
    await seedLedger(user.id, [
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 80, pointSource: WALLET_POINT_SOURCE.PURCHASED, at: t(1) },
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 80, pointSource: WALLET_POINT_SOURCE.PROMOTIONAL, at: t(2) },
      {
        type: WALLET_LEDGER_TYPE.DEBIT,
        amount: 50,
        pointSourceBreakdown: { purchased: 40, promotional: 10 },
        at: t(3),
      },
    ]);
    const ts = await getPointSourceBalances(user.id);
    const sql = await sqlSplitForUser(user.id);
    assert.ok(sql);
    assert.equal(ts.purchased, sql.purchased);
    assert.equal(ts.promotional, sql.promotional);
    assert.equal(ts.purchased, 40);
    assert.equal(ts.promotional, 70);
  });

  it('multiple mixed legacy and explicit-breakdown debits over time', async (test) => {
    if (!dbReady) return test.skip('database unavailable');
    const user = await createCustomer();
    await seedLedger(user.id, [
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 100, pointSource: WALLET_POINT_SOURCE.PURCHASED, at: t(1) },
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 40, pointSource: WALLET_POINT_SOURCE.PROMOTIONAL, at: t(2) },
      { type: WALLET_LEDGER_TYPE.DEBIT, amount: 10, at: t(3) },
      {
        type: WALLET_LEDGER_TYPE.DEBIT,
        amount: 30,
        pointSourceBreakdown: { purchased: 20, promotional: 10 },
        at: t(4),
      },
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 25, pointSource: WALLET_POINT_SOURCE.PROMOTIONAL, at: t(5) },
      { type: WALLET_LEDGER_TYPE.DEBIT, amount: 50, at: t(6) },
    ]);
    const ts = await getPointSourceBalances(user.id);
    const sql = await sqlSplitForUser(user.id);
    assert.ok(sql);
    assert.equal(ts.purchased, sql.purchased);
    assert.equal(ts.promotional, sql.promotional);
  });

  it('documents known TS vs SQL divergence when a later promo credit would have absorbed an earlier spillover', async (test) => {
    if (!dbReady) return test.skip('database unavailable');
    const user = await createCustomer();
    await seedLedger(user.id, [
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 100, pointSource: WALLET_POINT_SOURCE.PURCHASED, at: t(1) },
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 10, pointSource: WALLET_POINT_SOURCE.PROMOTIONAL, at: t(2) },
      { type: WALLET_LEDGER_TYPE.DEBIT, amount: 40, at: t(3) },
      { type: WALLET_LEDGER_TYPE.CREDIT, amount: 50, pointSource: WALLET_POINT_SOURCE.PROMOTIONAL, at: t(4) },
    ]);
    const ts = await getPointSourceBalances(user.id);
    const sql = await sqlSplitForUser(user.id);
    assert.ok(sql);
    // Canonical TS walk: debit 40 against promo 10 spills 30 into purchased → purchased 70,
    // then a later +50 promo credit lands entirely in promotional → promo 50.
    assert.equal(ts.purchased, 70);
    assert.equal(ts.promotional, 50);
    // Aggregate SQL treats the later +50 promo as if it had been available to absorb the
    // earlier debit, so purchased stays 100 and promo is only 20. Do not "fix" either
    // side here — this is a documented live divergence (audit 02 finding 6).
    assert.equal(sql.purchased, 100);
    assert.equal(sql.promotional, 20);
    assert.notEqual(ts.purchased, sql.purchased);
    assert.notEqual(ts.promotional, sql.promotional);
  });
});
