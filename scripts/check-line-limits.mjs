#!/usr/bin/env node
/**
 * Line-limit ratchet (mirrors web/scripts/check-line-limits.mjs).
 *
 * The backend has a tail of very large service files that cannot be safely
 * split in one step. Instead of an arbitrary ceiling, this script freezes
 * today's sizes in scripts/line-limits-baseline.json:
 *
 *   - A file that is in the baseline may only shrink (current <= baseline).
 *   - A file that is NOT in the baseline may not exceed NEW_FILE_LIMIT lines.
 *   - Deleted files are fine; prune stale baseline rows with --init.
 *
 * Run `node scripts/check-line-limits.mjs --init` to (re)generate the baseline
 * after an intentional, reviewed restructure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BASELINE_PATH = path.join(__dirname, 'line-limits-baseline.json');
const NEW_FILE_LIMIT = 300;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function countLines(file) {
  const content = fs.readFileSync(file, 'utf8');
  if (content.length === 0) return 0;
  return content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

const wantInit = process.argv.includes('--init');
const sizes = {};
for (const file of walk(SRC, [])) {
  sizes[relative(file)] = countLines(file);
}

if (wantInit) {
  const baseline = {};
  for (const [file, lines] of Object.entries(sizes).sort()) {
    if (lines > NEW_FILE_LIMIT) baseline[file] = lines;
  }
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Baseline written: ${Object.keys(baseline).length} grandfathered files.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error('Missing scripts/line-limits-baseline.json — run with --init first.');
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
const violations = [];

for (const [file, lines] of Object.entries(sizes)) {
  const recorded = baseline[file];
  if (recorded != null) {
    if (lines > recorded) {
      violations.push(`${file} is ${lines} lines (frozen at ${recorded}) — split it or justify --init.`);
    }
  } else if (lines > NEW_FILE_LIMIT) {
    violations.push(`${file} is ${lines} lines (new-file ceiling ${NEW_FILE_LIMIT}).`);
  }
}

const stale = Object.keys(baseline).filter((file) => sizes[file] == null);
if (stale.length > 0) {
  console.log(`Note: ${stale.length} baseline file(s) no longer exist (prune with --init).`);
}

if (violations.length > 0) {
  console.error('Line-limit ratchet violations:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`Line limits OK (${Object.keys(baseline).length} grandfathered files; new-file ceiling ${NEW_FILE_LIMIT}).`);
