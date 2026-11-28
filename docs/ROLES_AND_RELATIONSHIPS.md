# Roles and relationships

The marketplace has three roles. The full lifecycle of each is in [ROLE_LIFECYCLES.md](ROLE_LIFECYCLES.md).

| Role | Who it is | What they do |
|---|---|---|
| **Super Admin** (`SUPER_ADMIN`) | The company that runs the marketplace (one account) | Approves vendors and products, manages categories, tax and shipping, handles orders, returns, support, payouts and settings |
| **Vendor** (`VENDOR_OWNER`) | A business selling on the marketplace (one login per store) | Lists products, fulfils orders, restocks and disputes returns, runs store coupons, reads payouts and reports |
| **Customer** (`CUSTOMER`) | A shopper | Browses, buys, pays by card/UPI, wallet or cash on delivery, returns items, reviews, raises tickets |

## From a new vendor to a first sale

1. A customer registers a store and uploads the KYC documents; the account becomes a Vendor.
2. The Super Admin verifies the documents and approves the store.
3. The vendor lists a product and submits it; the Super Admin approves it.
4. A customer orders it; the vendor ships it; delivery is recorded.
5. The platform keeps its commission and pays the vendor in the next payout run.

## Permissions

Permissions are fixed per role (`backend/src/core/permissions/permissionKeys.ts`, mirrored by the roles seeder). There is no screen to create roles or change them.

| Role | Permissions |
|---|---|
| `SUPER_ADMIN` | all |
| `VENDOR_OWNER` | `product.create`, `product.update`, `product.delete`, `suborder.manage`, `payout.view`, `review.respond` |
| `CUSTOMER` | none (their own data only) |
