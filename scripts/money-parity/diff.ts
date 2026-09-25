/**
 * Compares two money parity snapshots (see snapshot.ts) and prints every leaf
 * value that changed, grouped by surface. Exits 1 when anything differs, so a
 * refactor that must not change numbers can assert an empty diff.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/money-parity/diff.ts before.json after.json
 */
import fs from 'node:fs';

type Json = unknown;

function leaves(value: Json, prefix: string, out: Map<string, Json>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => leaves(item, `${prefix}[${index}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, Json>)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, value);
  }
}

function main(): void {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    throw new Error('usage: diff.ts <before.json> <after.json>');
  }
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8')) as Record<string, Json>;
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf8')) as Record<string, Json>;

  let changed = 0;
  const surfaces = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const surface of surfaces) {
    const a = new Map<string, Json>();
    const b = new Map<string, Json>();
    leaves(before[surface], '', a);
    leaves(after[surface], '', b);
    const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
    const lines = paths
      .filter((path) => JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path)))
      .map((path) => `    ${path || '(value)'}: ${JSON.stringify(a.get(path))} → ${JSON.stringify(b.get(path))}`);
    if (lines.length > 0) {
      changed += lines.length;
      console.log(`${surface}`);
      console.log(lines.join('\n'));
    }
  }
  console.log(changed === 0 ? 'No differences.' : `\n${changed} value(s) differ.`);
  if (changed > 0) process.exitCode = 1;
}

main();
