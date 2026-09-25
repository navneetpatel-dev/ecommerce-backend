# Backend structure conventions — authoritative reference

**Purpose:** every backend file touched anywhere in this plan (files `02`–`07`) must strictly follow the rules below. Reverse-engineered from the real, live structure of `backend/` itself, using the same method as `../calculation-audit-remediation-plan/BACKEND-STRUCTURE-CONVENTIONS.md` and `../export-module-plan/BACKEND-STRUCTURE-CONVENTIONS.md`, but scoped to the much wider set of modules this plan touches: `users`, `suborders`, `returns`, `checkout`, `payouts`, `productQna`, `cart`, `wishlist`, `products`, `tax` (via `tcsLedger`/`tdsLedger` models), `shipping`, `deliveryAgents`, `payments`, `coupons`, `wallet`.

**Compliance status of this plan:** every backend file specified in `02`–`07` was checked against every rule below — see "Compliance audit" at the bottom.

---

## 1. The top-level shape

```
backend/
  database/
    config/        — Sequelize CLI connection config
    migrations/    — one timestamped file per schema change, flat, CommonJS
    models/        — one file per table, flat, aggregated by models/index.ts
    seeders/       — seed data scripts
  src/
    config/        — one file per external system/infra concern, flat
    core/          — cross-cutting, domain-agnostic engines/utilities (constants/statuses.ts,
                      permissions/permissionKeys.ts, repository/BaseRepository.ts, s3/mediaLifecycle.ts)
    jobs/          — BullMQ worker + cron processors
    middleware/    — Express middleware, one file per concern, flat
    modules/       — one folder per business domain
    realtime/      — Socket.IO server
    routes/        — single router aggregator
    testHelpers/   — shared test setup
    types/         — ambient/global TS augmentation
    utils/         — small generic helpers, flat
    app.ts, server.ts, worker.ts — process entry points
```

This plan touches **zero new top-level folders** and **zero new `modules/` folders** — every change is a targeted edit inside existing module folders (or their `__tests__/`), plus one new file, `.eslintrc.json`, at `backend/` root (F-08, `03-impl-phase2-high-priority.md`) — the one deliberate exception, since the finding *is* the absence of that file.

## 2. `modules/<domain>/` — the business-domain module shape (as observed)

```
modules/<domain>/
  <domain>.routes.ts        — Router: middleware chain + controller handler refs, no logic
  <domain>.controller.ts    — asyncHandler-wrapped: parse req → call service → shape res
  <domain>.service.ts       — business logic orchestration
  <domain>.repository.ts    — DB access (Sequelize model queries), where present
  <domain>.dto.ts           — Zod schemas + inferred types
  <domain>.constants.ts     — module-local constants (e.g. cart.constants.ts's MAX_CART_LINE_QUANTITY)
  __tests__/
    <thing>.test.ts
```

Every module this plan touches confirms the pattern — with these specific, confirmed shapes relevant to the fixes in this plan:

- **`modules/users/`**: `users.service.ts`, `users.repository.ts` (extends `BaseRepository<User>`), controller, routes, dto. **No `__tests__/` folder exists today** — F-06 (`02-impl-phase1-critical-financial-security.md`) is the first test coverage this module will get; create `modules/users/__tests__/users.service.test.ts` following the flat `.test.ts` shape other modules use, don't invent a different layout.
- **`modules/suborders/`**: also has **no `__tests__/` folder**. The only existing coverage of `suborders.service.ts`'s cancellation path lives in a *different* module's test file, `modules/vendors/__tests__/vendorGaps.service.test.ts` (describe block "SubOrder Cancellation Cascade"). F-01's fix should either extend that existing describe block or create `modules/suborders/__tests__/suborders.service.test.ts` — this plan's `02` file specifies which.
- **`modules/wallet/`** has a non-standard but confirmed-intentional extra file: `walletOrderRollback.ts` (the `rollbackOrderWalletIfNeeded` helper) sits alongside `wallet.service.ts`, `wallet.constants.ts`, `walletExpiry.ts` — a "wallet has several small focused files, not one giant service" pattern already established; F-01's fix adds logic *near* this file's existing idioms, not a new top-level file.
- **`modules/productQna/`** is a small, complete HTTP module (`productQna.service.ts`, `.controller.ts`, `.routes.ts`, `.dto.ts`) with **no `__tests__/`, no `.repository.ts`** (queries are inline in the service, which is consistent with other small modules like `reviews`). F-07's fix (moderation status, new DELETE/PATCH endpoints) stays inside this existing four-file shape; do not introduce a repository layer that doesn't already exist here.
- **`modules/payouts/`**: `payouts.service.ts` is the whole module's logic (class `PayoutsService`, method `process(actorId)` — note the audit's "`generatePayouts()`" name does not exist in code; the real method is `process`). F-04's fix touches two query sites inside this one file/method.
- **`modules/coupons/`**: business logic for coupon application spans `coupons.service.ts` AND a separate `couponEngine.ts` (pure functions: `validateCouponSet`, `recordCouponUsage`, `destroyCouponUsageForOrder`, `resolveCartCouponCodes`) — this engine/service split is this module's established internal shape, mirroring how `modules/pricing/` splits `pricing.engine.ts` from `pricing.service.ts`. F-03 and F-18 both consume `couponEngine.ts` exports from other modules (`checkout.service.ts`, `payments.service.ts`) via the `@modules/coupons/couponEngine` path alias — never reach into `coupons.service.ts` internals from outside the module.

**Route files never contain logic.** No step in this plan adds logic to a `.routes.ts` file beyond registering a new route with its middleware chain (F-05, F-07) — the handler body always lives in the controller, which always delegates to the service.

## 3. Database models (`backend/database/models/`)

One file per table, `<name>.model.ts`, exporting a class extending `Model<...>` plus an `init<Name>Model(sequelize)` factory function and a static `associate(models)` method. Confirmed shape for every model this plan touches (`ProductAnswer`, `TcsLedger`, `TdsLedger`, `Cart`, `Shipment`, `SubOrder`, `DeliveryAgent`, `DeliveryCashDeposit`). F-07's new `status` column on `ProductAnswer` follows the exact shape `ProductQuestion.status` already uses on its sibling model (`DataTypes.ENUM(...)`, `defaultValue: 'PENDING'`) — reuse that enum's value vocabulary (`PENDING`/`PUBLISHED`/`REJECTED`) rather than inventing a new one (`APPROVED`) for consistency with the sibling model, per `03-impl-phase2-high-priority.md`'s note.

## 4. Migrations (`backend/database/migrations/`)

Filename pattern: `<14-digit-timestamp>-<kebab-case-description>.js`, CommonJS, `module.exports = { async up(queryInterface, Sequelize) {...}, async down(queryInterface) {...} }`. Two confirmed sub-patterns this plan uses:

- **Adding a nullable/defaulted column** — template: `20260905000001-return-rejection-reason.js` (guards with `describeTable` before `addColumn`/`removeColumn`, symmetric up/down). F-07's new `ProductAnswer.status` column migration follows this shape.
- **Adding a unique index to an existing table** — template: `20240101000052-users-email-unique-global.js` (uses `queryInterface.addIndex(table, columns, { unique: true, name: '...', where: { deletedAt: null } })`, a **partial unique index** scoped to non-soft-deleted rows, matching every model in this plan being `paranoid: true`). F-13's `tcs_ledgers`/`tds_ledgers` unique-index migrations follow this shape exactly — including the `where: { deletedAt: null }` partial-index qualifier.

New migrations in this plan must be dated after the most recent existing migration (`20260916000001-export-jobs.js` as of this plan's writing) — use `2026091700000N` or later, never an earlier timestamp, regardless of when the migration is actually authored.

## 5. Path aliases

`@core`, `@config`, `@modules`, `@database`, `@middleware`, `@utils`, `@jobs`, `@realtime` — every import this plan adds uses these (e.g. `import { destroyCouponUsageForOrder } from '@modules/coupons/couponEngine';`), never a relative `../../../` reaching across top-level `src/` folders. Relative imports are fine *within* a module.

## 6. Naming conventions

| Kind | Pattern | Example from this plan |
|---|---|---|
| Exported pure function | camelCase, verb-first | `destroyCouponUsageForOrder`, `resolveReturnWindowForCategory` |
| Service method | camelCase | `deleteOwnAccount`, `applyShipmentStatus`, `moveToCart` |
| Enum constant object | SCREAMING_SNAKE keys, `as const` | `WALLET_POINT_SOURCE`, `RETURN_STATUS`, `PRODUCT_QUESTION_STATUS` |
| Test file | `<thing>.test.ts`, colocated `__tests__/` | `modules/suborders/__tests__/suborders.service.test.ts` |
| Migration file | `<timestamp>-<kebab-case>.js` | `20260917000001-product-answer-status.js` |

## 7. Permissions

`backend/src/core/permissions/permissionKeys.ts` defines every `PERMISSIONS.*` string key (dot-notation, e.g. `'order.refund'`, `'suborder.manage'`) and which `ROLES.*` each is granted to, in one central file. **Never hardcode a role check inline where a `PERMISSIONS` key already exists for the concept** — F-05's new vendor-returns endpoint reuses the already-vendor-granted `PERMISSIONS.SUBORDER_MANAGE` (confirmed already granted to `VENDOR_OWNER`/`VENDOR_STAFF`) rather than inventing a new permission key. If a genuinely new capability needs gating and no existing key fits, add it to this same central file — never a module-local ad hoc check.

## 8. Row locking & transactions

Every multi-step financial or state-machine mutation in this codebase runs inside `sequelize.transaction(async (t) => {...})`, and every row read that will be mutated later in the same transaction uses `{ transaction: t, lock: t.LOCK.UPDATE }`. This plan's fixes (F-01, F-04, F-06, F-17) all preserve this pattern exactly — none of them introduce a new transaction-less mutation path, and none relax an existing lock.

## 9. Test layout

Colocated `__tests__/` folders next to the code under test, `.test.ts` suffix, run via the built-in `tsx --test` runner (`backend/package.json`'s `test` script: `tsx --tsconfig tsconfig.json --test 'src/**/__tests__/**/*.test.ts'` — **not** jest/vitest). Every new test this plan adds goes in the existing or newly-created `__tests__/` folder of the module it tests.

## 10. What this plan does **not** do (explicitly out of scope, do not introduce)

- No stored procedures, triggers, or computed columns in the DB — this codebase deliberately keeps all calculation and business logic in the service layer.
- No new top-level `core/`/`modules/` folders, and no restructuring of an existing module's file layout beyond what a specific finding requires.
- No backfill scripts or historical-data recomputation — every fix in this plan is forward-looking-only (new rows created after the fix behave correctly; existing rows are not retroactively corrected unless a finding's file explicitly says so and gets separate sign-off, per `09-rollout-sequencing-and-priorities.md`).
- ESLint 9 flat config in `backend/` (F-08) — confirmed `backend`'s installed `eslint` is `^8.57.0` (legacy config format), vs. `web`'s `^9` (flat config). Do not try to unify these; they are intentionally on different majors.

---

## Compliance audit — every backend file this plan specifies, checked against the rules above

| Rule | File(s) checked | Result |
|---|---|---|
| No new top-level folders | All backend changes, `02`–`07` | ✅ Only new file is `backend/.eslintrc.json` (F-08, the finding itself) |
| First test file in a module with no `__tests__/` yet matches sibling modules' flat shape | `modules/users/__tests__/users.service.test.ts`, `modules/suborders/__tests__/suborders.service.test.ts` | ✅ Matches flat `.test.ts` shape used everywhere else |
| New model column mirrors sibling model's existing enum vocabulary | `ProductAnswer.status` (F-07) | ✅ Reuses `PENDING`/`PUBLISHED`/`REJECTED` from `ProductQuestion.status`, not a new `APPROVED` vocabulary |
| Migration filename/shape matches an existing template | F-07's column-add, F-13's index-add | ✅ `describeTable`-guarded column add; partial unique index with `where: { deletedAt: null }` |
| Path aliases only | All new imports, `02`–`07` | ✅ |
| Route files contain no logic | F-05, F-07 new routes | ✅ Handler bodies live in controllers/services |
| Existing `PERMISSIONS` keys reused, not reinvented | F-05 (`SUBORDER_MANAGE`) | ✅ |
| Transactions + row locking preserved | F-01, F-04, F-06, F-17 | ✅ No transaction-less mutation introduced, no lock relaxed |
| `tsx --test` runner, colocated `__tests__/` | All new tests | ✅ |
| No stored procedures / SQL-side business logic introduced | All steps | ✅ |

The one item this audit flags rather than claims: `modules/productQna/`'s lack of a `.repository.ts` layer (queries inline in the service) is unusual relative to larger modules like `users`/`products`, but consistent with other small modules (`reviews`) — F-07 preserves this shape rather than introducing a repository layer that doesn't otherwise exist in this module, since doing so would be scope creep beyond the finding.
