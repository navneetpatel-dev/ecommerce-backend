import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

/**
 * No transaction context is propagated automatically, so a service that reads its own records
 * inside `sequelize.transaction(...)` without passing the transaction sees the old data: a new
 * row is "not found" (and the whole write rolls back), an update answers with the old values.
 * Read after the transaction returns, or pass it to the read.
 */
const ROOT = path.resolve(__dirname, '../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : sources(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

function offenders(source: string): string[] {
  const found: string[] = [];
  const opening = /sequelize\.transaction\(\s*async\s*\(\s*(\w+)[^)]*\)[^{=]*=>\s*\{/g;
  for (let match = opening.exec(source); match; match = opening.exec(source)) {
    let end = match.index + match[0].length;
    for (let depth = 1; end < source.length && depth > 0; end += 1) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}') depth -= 1;
    }
    const body = source.slice(match.index + match[0].length, end);
    const passes = new RegExp(`\\b(${match[1]}|transaction)\\b`);
    for (const call of body.matchAll(/(?:return|await)\s+this\.((?:get|find|list)\w*)\(([^;]*?)\);/g)) {
      if (!passes.test(call[2]!)) found.push(call[1]!);
    }
  }
  return found;
}

describe('reads inside a transaction', () => {
  it('recognises the mistake', () => {
    const bad = 'return sequelize.transaction(async (t) => { await save(t); return this.getThing(id); });';
    assert.deepEqual(offenders(bad), ['getThing']);
    assert.deepEqual(offenders('await sequelize.transaction(async (t) => { await this.getThing(id, t); });'), []);
  });

  it('no service reads its own records outside the transaction it is in', () => {
    const problems = sources(ROOT).flatMap((file) =>
      offenders(readFileSync(file, 'utf8')).map((call) => `${path.relative(ROOT, file)}: ${call}()`),
    );
    assert.deepEqual(problems, []);
  });
});
