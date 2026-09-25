/**
 * Money parity snapshot.
 *
 * Captures every money figure the read surfaces publish (all registered reports,
 * admin analytics, vendor dashboards, delivery shift summaries, commission ledgers)
 * from the current database into one JSON file. Run it before and after a change to
 * money read paths, then diff the two files: any difference must be one the change
 * intended.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/money-parity/snapshot.ts before.json
 *   ...apply change...
 *   npx tsx --tsconfig tsconfig.json scripts/money-parity/snapshot.ts after.json
 *   npx tsx --tsconfig tsconfig.json scripts/money-parity/diff.ts before.json after.json
 */
import fs from 'node:fs';
import { sequelize } from '@database/models';
import { Vendor } from '@database/models/vendor.model';
import { DeliveryAgent } from '@database/models/deliveryAgent.model';
import { ALL_REPORT_DEFINITIONS } from '@modules/reports/definitions';
import { adminService } from '@modules/admin/admin.service';
import { vendorsService } from '@modules/vendors/vendors.service';
import { deliveryAgentsService } from '@modules/deliveryAgents/deliveryAgents.service';
import { commissionsService } from '@modules/commissions/commissions.service';

/** Trailing year up to tomorrow — the widest window reports accept (REPORT_MAX_RANGE_DAYS = 366). */
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_END = new Date(Math.ceil(Date.now() / DAY_MS) * DAY_MS + DAY_MS);
const RANGE = { from: new Date(RANGE_END.getTime() - 365 * DAY_MS), to: RANGE_END };
const PAGE = { page: 1, limit: 100_000 };

/** Fields whose value depends on wall-clock time rather than stored money. */
const VOLATILE_KEYS = new Set(['asOf', 'generatedAt', 'createdAt', 'updatedAt', 'expiresAt']);

function stable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const plain =
      typeof (value as { toJSON?: () => unknown }).toJSON === 'function' &&
      !(value instanceof Date)
        ? ((value as { toJSON: () => unknown }).toJSON() as Record<string, unknown>)
        : (value as Record<string, unknown>);
    return Object.fromEntries(
      Object.keys(plain)
        .filter((key) => !VOLATILE_KEYS.has(key))
        .sort()
        .map((key) => [key, stable(plain[key])]),
    );
  }
  return value;
}

async function capture(label: string, run: () => Promise<unknown>): Promise<unknown> {
  process.stderr.write(`  ${label}\n`);
  try {
    return stable(await run());
  } catch (error) {
    return { error: `${label}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function main(): Promise<void> {
  const outPath = process.argv[2];
  if (!outPath) {
    throw new Error('usage: snapshot.ts <out.json>');
  }
  await sequelize.authenticate();

  const vendors = await Vendor.findAll({ attributes: ['id'], order: [['id', 'ASC']] });
  const agents = await DeliveryAgent.findAll({ attributes: ['id'], order: [['id', 'ASC']] });
  const snapshot: Record<string, unknown> = {};

  for (const def of [...ALL_REPORT_DEFINITIONS].sort((a, b) => a.type.localeCompare(b.type))) {
    if (def.audience === 'customer') continue;
    if (def.vendorScoped) {
      for (const vendor of vendors) {
        snapshot[`report:${def.type}:vendor:${vendor.id}`] = await capture(def.type, () =>
          def.query({ ...RANGE, ...PAGE, vendorId: vendor.id, scopedVendorId: vendor.id }),
        );
      }
    } else {
      snapshot[`report:${def.type}`] = await capture(def.type, () =>
        def.query({ ...RANGE, ...PAGE }),
      );
    }
  }

  snapshot['admin:platformAnalytics'] = await capture('admin analytics', () =>
    adminService.getPlatformAnalytics(),
  );

  for (const vendor of vendors) {
    snapshot[`vendor:${vendor.id}:dashboardSummary`] = await capture('vendor stats', () =>
      vendorsService.getDashboardSummary(vendor.id),
    );
    snapshot[`vendor:${vendor.id}:analytics`] = await capture('vendor analytics', () =>
      vendorsService.getDashboardAnalytics(vendor.id, 36_500),
    );
    snapshot[`vendor:${vendor.id}:commissions`] = await capture('commissions', () =>
      commissionsService.list(PAGE, vendor.id),
    );
  }

  for (const agent of agents) {
    snapshot[`agent:${agent.id}:shiftSummary`] = await capture('shift summary', () =>
      deliveryAgentsService.shiftSummary(agent.id),
    );
  }

  fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  const errors = Object.entries(snapshot).filter(
    ([, value]) => value && typeof value === 'object' && 'error' in value,
  );
  console.log(`Wrote ${Object.keys(snapshot).length} surfaces to ${outPath} (${errors.length} errored).`);
  for (const [key, value] of errors) {
    console.log(`  ${key}: ${(value as { error: string }).error}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
    // Queue and cache clients opened by imported services keep the event loop alive.
    process.exit();
  });
