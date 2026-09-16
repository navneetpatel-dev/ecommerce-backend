export type CheckResult = {
  scenario: string;
  label: string;
  pass: boolean;
  detail?: string;
};

const results: CheckResult[] = [];

export function check(scenario: string, label: string, pass: boolean, detail?: string) {
  results.push({ scenario, label, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`  ${icon} [${scenario}] ${label}${detail ? ' — ' + detail : ''}`);
}

export function assertEqual(
  scenario: string,
  label: string,
  actual: unknown,
  expected: unknown,
) {
  const pass = actual === expected;
  check(scenario, label, pass, pass ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertClose(
  scenario: string,
  label: string,
  actual: number,
  expected: number,
  tolerance = 0.02,
) {
  const a = Number(actual);
  const e = Number(expected);
  const pass = Number.isFinite(a) && Number.isFinite(e) && Math.abs(a - e) <= tolerance;
  check(
    scenario,
    label,
    pass,
    pass ? undefined : `expected ≈${e} (±${tolerance}), got ${a} (diff ${Math.abs(a - e).toFixed(4)})`,
  );
}

export function assertTrue(scenario: string, label: string, condition: boolean, detail?: string) {
  check(scenario, label, condition, condition ? undefined : detail);
}

export function printSummary(): number {
  const failed = results.filter((r) => !r.pass);
  const passed = results.length - failed.length;
  console.log('\n' + '='.repeat(70));
  console.log(`SUMMARY: ${passed}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log(`\nFAILURES (${failed.length}):`);
    for (const f of failed) {
      console.log(`  ❌ [${f.scenario}] ${f.label}${f.detail ? ' — ' + f.detail : ''}`);
    }
  }
  console.log('='.repeat(70));
  return failed.length;
}

export function getResults() {
  return results;
}
