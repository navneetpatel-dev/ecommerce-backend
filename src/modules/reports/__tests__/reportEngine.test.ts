/**
 * Report engine verification: access control, Excel↔JSON parity, TCS ledger parity.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { sequelize } from '@database/models';
import { Vendor } from '@database/models/vendor.model';
import { ROLES } from '@core/constants/statuses';
import { PERMISSIONS as PERM_KEYS } from '@core/permissions/permissionKeys';
import { reportEngine, type ReportActor } from '../engine/reportEngine';
import { getReportDefinition } from '../engine/reportRegistry';
import { buildExcelBuffer } from '../engine/excelExporter';
import { fromPaise } from '@modules/pricing/money';
import { normalizeReportFilters, REPORTABLE_ORDER_SQL } from '../engine/queryHelpers';
import { resolveReportColumnLabel } from '../reports.constants';

let dbReady = false;
const cleanup = { vendors: [] as string[] };

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

describe('report engine', () => {
  before(async () => {
    try {
      await withTimeout(sequelize.authenticate(), 2000);
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  after(async () => {
    if (!dbReady) return;
    try {
      for (const id of cleanup.vendors) await Vendor.destroy({ where: { id }, force: true });
      await sequelize.close();
    } catch {
      /* ignore */
    }
  });

  it('registers all required report types', () => {
    const required = [
      'gst-tcs-summary',
      'tds-194o-summary',
      'hsn-sales-summary',
      'state-tax-collection',
      'reconciliation',
      'credit-debit-note-register',
      'vendor-settlement',
      'commission-revenue',
      'coupon-discount-cost',
      'gmv-sales',
      'audit-log',
      'order-sla',
      'cancellations',
      'refund-return',
      'product-performance',
      'category-performance',
      'product-approval-tat',
      'review-rating-summary',
      'vendor-sales',
      'vendor-gst-sales',
      'vendor-tcs-credit',
      'vendor-tds-certificate',
      'vendor-payout-statement',
      'vendor-commission-deducted',
      'vendor-discount-cost',
      'vendor-return-refund',
      'vendor-inventory',
      'vendor-fulfillment-sla',
      'staff-orders',
      'staff-inventory',
      'customer-order-history',
    ];
    for (const type of required) {
      assert.ok(getReportDefinition(type), `missing ${type}`);
    }
  });

  it('vendor staff catalog excludes financial reports', () => {
    const staff: ReportActor = {
      id: randomUUID(),
      vendorId: randomUUID(),
      roleName: ROLES.VENDOR_STAFF,
      permissions: [PERM_KEYS.PRODUCT_UPDATE, PERM_KEYS.SUBORDER_MANAGE],
    };
    const catalog = reportEngine.catalog(staff);
    assert.ok(catalog.every((d) => !d.financial));
    assert.ok(catalog.some((d) => d.type === 'staff-orders' || d.type === 'staff-inventory'));
  });

  it('vendor owner gets 403 when probing another vendorId', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const vendorA = await Vendor.create({
      businessName: 'A',
      slug: `va-${randomUUID().slice(0, 8)}`,
      gstNumber: null,
      state: 'KA',
      bankDetails: {},
      logoUrl: null,
      bannerUrl: null,
      description: null,
      status: 'APPROVED',
      rejectionReason: null,
      suspensionReason: null,
      commissionRate: 10,
      performanceScore: 0,
      returnShippingFee: null,
      createdBy: null,
      updatedBy: null,
      deletedBy: null,
    } as any);
    cleanup.vendors.push(vendorA.id);
    const actor: ReportActor = {
      id: randomUUID(),
      vendorId: vendorA.id,
      roleName: ROLES.VENDOR_OWNER,
      permissions: [PERM_KEYS.PAYOUT_VIEW],
    };
    await assert.rejects(
      () =>
        reportEngine.runJson(actor, 'vendor-sales', {
          from: new Date('2024-01-01'),
          to: new Date('2026-12-31'),
          vendorId: randomUUID(),
          page: 1,
          limit: 50,
        }),
      /Not your vendor report|REPORT_FORBIDDEN|Forbidden/i,
    );
  });

  it('staff is forbidden from financial report types', async () => {
    const staff: ReportActor = {
      id: randomUUID(),
      vendorId: randomUUID(),
      roleName: ROLES.VENDOR_STAFF,
      permissions: [PERM_KEYS.PRODUCT_UPDATE, PERM_KEYS.SUBORDER_MANAGE],
    };
    await assert.rejects(
      () =>
        reportEngine.runJson(staff, 'vendor-sales', {
          from: new Date('2024-01-01'),
          to: new Date('2026-12-31'),
          page: 1,
          limit: 10,
        }),
      /do not have access|REPORT_FORBIDDEN|Forbidden/i,
    );
  });

  it('TCS summary totals match ledger rows (frozen)', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const def = getReportDefinition('gst-tcs-summary')!;
    const from = new Date('2000-01-01');
    const to = new Date('2099-01-01');
    const filters = normalizeReportFilters({ from, to, page: 1, limit: 10000 });
    const result = await def.query(filters);
    const vendorRows = result.rows.filter((r) => r.groupType === 'VENDOR');
    const reportTotal = vendorRows.reduce((s, r) => s + Number(r.tcsTotal ?? 0), 0);

    const [ledgerAgg] = (await sequelize.query(
      `
      SELECT COALESCE(SUM(t."tcsAmountPaise"), 0)::bigint AS "tcsTotalPaise"
      FROM tcs_ledgers t
      INNER JOIN orders o ON o.id = t."orderId" AND o."deletedAt" IS NULL
      WHERE t."deletedAt" IS NULL
        AND t."createdAt" BETWEEN :from AND :to
        AND ${REPORTABLE_ORDER_SQL}
      `,
      {
        replacements: { from: filters.from, to: filters.to },
      },
    )) as [{ tcsTotalPaise: string }[]];

    const ledgerTotal = fromPaise(Number(ledgerAgg[0]?.tcsTotalPaise ?? 0));
    assert.ok(Math.abs(reportTotal - ledgerTotal) < 0.02 || result.total === 0);
  });

  it('Excel cell values match JSON rows for reconciliation', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const admin: ReportActor = {
      id: randomUUID(),
      vendorId: null,
      roleName: ROLES.SUPER_ADMIN,
      permissions: [...Object.values(PERM_KEYS)],
    };
    const filters = {
      from: new Date('2020-01-01'),
      to: new Date('2030-01-01'),
      page: 1,
      limit: 50,
    };
    const json = await reportEngine.runJson(admin, 'reconciliation', filters);
    assert.ok(json.rows.length >= 1);
    const def = getReportDefinition('reconciliation')!;
    const buffer = await buildExcelBuffer(def.columns, json.rows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0]!;
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell) => headers.push(String(cell.value ?? '')));
    for (const col of def.columns) {
      assert.ok(
        headers.includes(resolveReportColumnLabel(col.labelKey)),
        `missing header ${col.labelKey}`,
      );
    }
    const dataRow = sheet.getRow(2);
    const statusIdx = def.columns.findIndex((c) => c.key === 'status') + 1;
    const statusCell = String(dataRow.getCell(statusIdx).value ?? '');
    assert.equal(statusCell, String(json.rows[0]!.status));
    const diffIdx = def.columns.findIndex((c) => c.key === 'difference') + 1;
    const diffCell = Number(dataRow.getCell(diffIdx).value ?? 0);
    assert.ok(Math.abs(diffCell - Number(json.rows[0]!.difference ?? 0)) < 0.02);
  });

  it('reconciliation report exposes BALANCED or MISMATCH status', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const admin: ReportActor = {
      id: randomUUID(),
      vendorId: null,
      roleName: ROLES.SUPER_ADMIN,
      permissions: [...Object.values(PERM_KEYS)],
    };
    const data = await reportEngine.runJson(admin, 'reconciliation', {
      from: new Date('2020-01-01'),
      to: new Date('2030-01-01'),
      page: 1,
      limit: 10,
    });
    assert.ok(data.rows.length >= 1);
    const status = String(data.rows[0]!.status ?? data.meta?.status ?? '');
    assert.ok(status === 'BALANCED' || status === 'MISMATCH');
  });

  it('order-sla Excel headers match JSON column labels', async () => {
    const def = getReportDefinition('order-sla')!;
    const rows = [
      {
        vendorId: randomUUID(),
        vendorName: 'Test',
        orderCount: 2,
        avgFulfillmentHours: 12.5,
      },
    ];
    const buffer = await buildExcelBuffer(def.columns, rows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const headers: string[] = [];
    wb.worksheets[0]!.getRow(1).eachCell((c) => headers.push(String(c.value ?? '')));
    for (const col of def.columns) {
      assert.ok(headers.includes(resolveReportColumnLabel(col.labelKey)));
    }
  });

  it('super admin can run vendor-scoped report without vendorId', async (t) => {
    if (!dbReady) return t.skip('database unavailable');
    const actor: ReportActor = {
      id: randomUUID(),
      vendorId: null,
      roleName: ROLES.SUPER_ADMIN,
      permissions: [],
    };
    const result = await reportEngine.runJson(actor, 'vendor-sales', {
      from: new Date('2024-01-01'),
      to: new Date('2026-12-31'),
      page: 1,
      limit: 5,
    });
    assert.equal(result.reportType, 'vendor-sales');
    assert.ok(Array.isArray(result.rows));
  });

  it('inclusive to-date covers the selected calendar day', async () => {
    const { inclusiveReportTo } = await import('../engine/queryHelpers');
    const end = inclusiveReportTo(new Date('2026-08-08T00:00:00.000Z'));
    assert.equal(end.getUTCHours(), 23);
    assert.equal(end.getUTCMinutes(), 59);
  });
});
