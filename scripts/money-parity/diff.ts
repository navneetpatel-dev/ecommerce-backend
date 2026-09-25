/**
 * Compares two money parity snapshots (see snapshot.ts) and prints every leaf
 * value that changed, grouped by surface. Exits 1 when anything differs, so a
 * refactor that must not change numbers can assert an empty diff.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/money-parity/diff.ts before.json after.json
 *
 * Pass --unordered to compare arrays of rows as multisets. Use it after a change that
 * rewrites rows (a backfill migration): Postgres may then return rows that tie on the
 * report's ORDER BY in a different order, which is not a money difference.
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

/** Sorts every array of objects by content so row order stops mattering. */
function unorder(value: Json): Json {
  if (Array.isArray(value)) {
    const items = value.map(unorder);
    if (items.every((item) => item !== null && typeof item === 'object')) {
      return items
        .map((item) => [JSON.stringify(item), item] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, item]) => item);
    }
    return items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, Json>).map(([key, child]) => [key, unorder(child)]),
    );
  }
  return value;
}

function main(): void {
  const args = process.argv.slice(2);
  const unordered = args.includes('--unordered');
  const [beforePath, afterPath] = args.filter((arg) => !arg.startsWith('--'));
  if (!beforePath || !afterPath) {
    throw new Error('usage: diff.ts [--unordered] <before.json> <after.json>');
  }
  const read = (path: string) => {
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8')) as Record<string, Json>;
    return unordered ? (unorder(parsed) as Record<string, Json>) : parsed;
  };
  const before = read(beforePath);
  const after = read(afterPath);

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
