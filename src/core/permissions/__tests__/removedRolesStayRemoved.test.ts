import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

/**
 * The platform has three roles. Nothing outside the migrations (history) and the tests that prove
 * the removal may name the roles, permissions or routes that were taken out.
 */
const ROOT = path.resolve(__dirname, '../../../..');
const SCANNED = ['src', 'database/models', 'database/seeders', 'scripts'];
const REMOVED =
  /VENDOR_STAFF|ADMIN_(ORDER|CATALOG|FINANCE)_MANAGER|['"](team\.manage|role\.manage|coupon\.unlimited|analytics\.revenue)['"]|\/me\/staff|API_MOUNTS\.roles/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : files(full);
    return /\.(ts|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

describe('removed roles stay removed', () => {
  it('no source, model, seeder or script names a removed role, permission or route', () => {
    const offenders = SCANNED.flatMap((dir) => files(path.join(ROOT, dir))).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) => (REMOVED.test(line) ? [`${path.relative(ROOT, file)}:${index + 1}  ${line.trim()}`] : [])),
    );
    assert.deepEqual(offenders, []);
  });
});
