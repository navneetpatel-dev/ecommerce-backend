# Money parity snapshot

Proves a change to a money read path moves only the numbers it means to. `snapshot.ts` records
every money figure the read surfaces publish: all registered reports (vendor-scoped ones once
per vendor), admin analytics, vendor dashboards, delivery shift summaries and commission
ledgers. `diff.ts` prints every value that differs between two snapshots.

## Run

```bash
# 1. A seeded database to copy from (once)
createdb ecommerce_seed_tpl
DB_NAME=ecommerce_seed_tpl npx sequelize-cli db:migrate
DB_NAME=ecommerce_seed_tpl npx sequelize-cli db:seed:all

# 2. Before: a fresh copy, snapshot with the base branch checked out
psql -c 'DROP DATABASE IF EXISTS ecommerce_parity' -c 'CREATE DATABASE ecommerce_parity TEMPLATE ecommerce_seed_tpl'
DB_NAME=ecommerce_parity npx tsx --tsconfig tsconfig.json scripts/money-parity/snapshot.ts before.json

# 3. After: another fresh copy, snapshot with the change checked out
psql -c 'DROP DATABASE IF EXISTS ecommerce_parity' -c 'CREATE DATABASE ecommerce_parity TEMPLATE ecommerce_seed_tpl'
DB_NAME=ecommerce_parity npx tsx --tsconfig tsconfig.json scripts/money-parity/snapshot.ts after.json

npx tsx --tsconfig tsconfig.json scripts/money-parity/diff.ts before.json after.json
```

`diff.ts` exits 1 when anything differs, so a refactor that must not change numbers can assert
an empty diff.

After a migration that rewrites rows (a backfill), pass `--unordered`. Postgres may then return
rows that tie on a report's `ORDER BY` in a different order; `--unordered` compares arrays of rows
as multisets, so only real value changes remain.

## Keep the comparison fair

- **Snapshot from a fresh copy each time.** The test suite writes fixtures into whatever
  database it runs against, which moves platform totals.
- **Take before and after back to back.** Several surfaces use rolling windows (`NOW() - 30 days`,
  "today", order age), so snapshots taken an hour apart differ even with no code change.
  Snapshot the base branch twice first; if those two differ, the gap between runs is too long.
