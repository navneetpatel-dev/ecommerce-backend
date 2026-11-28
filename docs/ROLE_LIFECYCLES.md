# Application Role Lifecycles (Start to End)

This document describes every role in the e-commerce platform, covering **how each role enters the system (onboarding/signup), what it can and cannot do during its active lifecycle, and how its lifecycle ends or transitions**.

---

## 1. Role Hierarchy & Overview

The platform has **three roles** (`src/core/constants/statuses.ts` and the roles seeder) plus an unauthenticated Guest state. There are no custom roles, and no screen or API changes an account's role: it changes only when a customer registers a store (becomes a Vendor) or a store is deleted (back to Customer).

| Role Key | Display Name | Scope | How an account gets it |
| :--- | :--- | :--- | :--- |
| *(Unauthenticated)* | **Guest Visitor** | Public storefront | No account required |
| `CUSTOMER` | **Customer** | Storefront and account | Self-signup (email/password or Google) |
| `VENDOR_OWNER` | **Vendor** | Storefront and `/vendor/dashboard` | A customer registers a store; one login per store |
| `SUPER_ADMIN` | **Super Admin** | Whole platform | Seeded on deploy (`ADMIN_EMAIL`) |

---

## 2. Guest Visitor (Unauthenticated)

### Entry & Session
- Arrives on the public storefront (`/`, `/products`, `/category/[...slug]`, `/vendors`, `/vendors/[slug]`).
- No JWT token is sent; routes using `optionalAuthenticate` (catalog browsing, reviews read, cart) treat the visitor as a guest.

### Active Capabilities
- **Browse & Search:** View approved products, categories, approved vendor storefronts (`/vendors/[slug]`), product comparisons (`/compare`), FAQ, help articles, blog posts, about/contact pages, and short links (`/s/[code]`).
- **Guest Cart:** Add, update, remove, and clear items in a guest cart (`/api/cart/*`).
- **Public Promotions & Newsletter:** View publicly eligible coupons (`/api/coupons/eligible-public`), subscribe to (`POST /api/newsletter`) or confirm/unsubscribe from the newsletter.

### Restrictions & Maintenance Mode
- **Blocked Actions:** Cannot checkout (`POST /api/checkout/*`), use wallet/gift cards, manage wishlist, post reviews/Q&A, open support tickets, or file bug reports.
- **Maintenance Mode:** When platform maintenance mode is enabled, storefront document requests are rewritten to `/maintenance` (HTTP `503`) by `web/src/proxy.ts`.

### Transition / End
- Signs up or logs in → Guest cart is merged into the authenticated user's cart via `POST /api/cart/merge`.

---

## 3. `CUSTOMER` (Customer)

### 1. Signup & Onboarding
- **Registration:**
  - **Email & Password:** `POST /api/auth/register` (`/register`) creates a user with role `CUSTOMER`, `status: ACTIVE`, `emailVerified: false`, and dispatches a verification email (`/verify-email`).
  - **Google OAuth:** `/api/auth/google` → `/api/auth/google/callback` (`/auth/callback`).
  - **Soft-Deleted Re-registration:** If a previously soft-deleted email registers again, `reactivateDeletedAccount` restores the row, resets the password, clears old refresh tokens, and requires email re-verification (unless the account was `BLOCKED`).
- **Authentication & Sessions:**
  - Login via password (`POST /api/auth/login`), email OTP (`/otp`, `POST /api/auth/otp/request` & `/verify`), or Google OAuth.
  - Uses short-lived JWT access tokens + rotating refresh tokens (`POST /api/auth/refresh`), with active session listing and revocation (`GET/DELETE /api/auth/sessions`).
  - Password recovery via `/forgot-password` and `/reset-password`.

### 2. Active Functionality
- **Profile & Addresses:**
  - View/edit profile (`/profile`, `GET/PATCH /api/users/me`), change password, manage saved shipping addresses and default address (`/api/users/addresses`), and export personal account data (`GET /api/users/me/export`).
- **Shopping & Checkout:**
  - Browse products, track recently viewed items (`/api/products/recently-viewed`), manage wishlist (`/wishlist`), and participate in Product Q&A (`/questions`, `/answers`).
  - Apply/remove coupons (`/api/coupons/apply`, `/remove`, `/eligible`), request checkout quote (`POST /api/checkout/quote`), place orders (`POST /api/checkout`), verify payments (`POST /api/checkout/verify`), or cancel/resume pending checkouts (`/cancel`, `/resume`).
  - *(New purchases are blocked during maintenance mode.)*
- **Wallet, Cashback & Gift Cards:**
  - View wallet balance (`/wallet`), recharge wallet (`POST /api/wallet/recharge` & `/verify`), download recharge invoices, view cashback ledger (`/wallet/cashback`), and export wallet statements (`GET /api/wallet/statement`).
  - Purchase, view (`/gift-cards/mine`), and redeem (`/gift-cards/redeem/[code]`) gift cards.
- **Orders, Returns & Reviews:**
  - Track orders (`/orders`, `/orders/[orderId]`, `/orders/tracking`) and cancel eligible orders (`POST /api/orders/:id/cancel`).
  - Request returns (`/my-returns`, `POST /api/returns`), withdraw a requested return (`POST /api/returns/:id/cancel`), and download credit notes (`GET /api/returns/:id/credit-note`).
  - Write, edit, and delete product reviews (`/reviews/write`, `/api/reviews`), vote on reviews, and flag inappropriate reviews.
- **Support & Bug Reports:**
  - Create and reply to support tickets (`/support/tickets`, `/api/support-tickets`), resolve, reopen, close, and rate resolved tickets.
  - Submit bug reports (`/support/bug-reports/new`), comment on them, and verify fixes (`POST /api/bug-reports/:id/verify`).

### 3. Role Transitions & End of Lifecycle
- **Upgrade to Vendor:** Applies via `/vendor/register` (`POST /api/vendors/register`), which makes the account a Vendor.
- **Blocked by Admin:** `status` set to `BLOCKED` → all refresh tokens are revoked and API requests return `401`.
- **Account Deletion:** Can soft-delete own account (`DELETE /api/users/me`), which revokes all refresh tokens, soft-deletes the user row, and cascades deletion of user media in S3. Can also be soft-deleted by an admin.

---

## 4. `VENDOR_OWNER` (Vendor)

**Permissions:** `product.create`, `product.update`, `product.delete`, `suborder.manage`, `payout.view`, `review.respond`.

### 1. Onboarding & KYC Verification
- **Store Registration:**
  - Requires an existing authenticated account (`CUSTOMER`).
  - Submits `/vendor/register` (`POST /api/vendors/register`) with `businessName`, `entityType`, `categoryIds`, `bankDetails`, and optional `gstNumber`, `state`, and `description`.
  - Backend creates a `Vendor` in `PENDING` status, generates a unique store slug, updates the user's `roleId` to `VENDOR_OWNER` and sets `vendorId`, builds a dynamic KYC checklist, and notifies `SUPER_ADMIN`.
- **KYC Document Submission:**
  - Uploads required documents (`POST /api/vendors/me/documents`) and tracks verification progress (`GET /api/vendors/me/kyc-checklist`).
- **Admin Review Outcomes:**
  - **`APPROVED`:** Storefront `/vendors/[slug]` becomes public; vendor can actively sell and receive orders.
  - **`REJECTED`:** Store remains off storefront with a `rejectionReason`.
  - **`SUSPENDED` / `UNSUSPENDED`:** Admin may suspend an approved vendor (optionally cancelling `PENDING`/`CONFIRMED` suborders) and later unsuspend back to `APPROVED`.

### 2. Active Functionality (`/vendor/dashboard/*`)
- **Dashboard & Analytics:** View store summary (`/vendor/dashboard/overview`), analytics (`/vendor/dashboard/analytics`), and downloadable reports (`/vendor/dashboard/reports`).
- **Shop Settings & Profile:** Update store details and bank details (`/vendor/dashboard/shop-settings`, `PATCH /api/vendors/me`), and manage personal profile (`/vendor/dashboard/profile`).
- **Product Catalog (`/vendor/dashboard/products`):**
  - Create, edit, and delete own products, variants, and images (`checkOwnership('product')`). A listing on sale or awaiting approval keeps at least one variant and one image. Other stores' products are seen only as shoppers see them.
  - A **rejected** listing shows the moderator's note and can be resubmitted ; it always returns to the moderation queue.
  - An option whose price with GST is above the product's MRP is not on sale until the price or MRP is corrected; the vendor is emailed when a tax or category change causes this.
  - Every product belongs to a vendor.
  - Bulk import products via CSV (`POST /api/products/bulk-import`), preview GST (`GET /api/products/gst-preview`), and submit draft products for admin approval (`POST /api/products/:id/submit`).
- **Store Coupons (`/vendor/dashboard/coupons`):**
  - Create, update, and toggle status of vendor-scoped coupons (`POST/PATCH /api/coupons/vendor`, `/vendor/:id/status`), and view absorbed coupon analytics.
- **Orders & Returns (`/vendor/dashboard/orders`, `/returns`):**
  - View vendor suborders and update fulfillment statuses (`PATCH /api/suborders/:id/status` with `checkOwnership('suborder')`).
  - View return requests (`GET /api/returns/vendor/me`), mark items restocked (`POST /api/returns/:id/restock`), dispute returns (`POST /api/returns/:id/dispute`), and download debit notes (`GET /api/returns/:id/debit-note`).
- **Payouts (`/vendor/dashboard/payouts`):** View vendor payout history and settlement statuses (`GET /api/payouts`).
- **Reviews, Q&A & Support:**
  - Respond to customer reviews (`/vendor/dashboard/reviews`, `PATCH /api/reviews/:id/respond`) and answer product Q&A (`/vendor/dashboard/qna`).
  - View and reply to vendor-assigned support tickets (`/vendor/dashboard/support-tickets`) and submit bug reports (`/vendor/dashboard/bug-reports`).

### 3. End of Lifecycle
- `/vendor/*` routes remain accessible during maintenance mode.
- Self-deletion is guarded (`assertSelfDeletionAllowed`) to prevent orphaning a store; vendor accounts are suspended/deleted by admins (`DELETE /api/vendors/:id`) or have their account status updated by the Super Admin. Deleting a store returns its login to `CUSTOMER`.

---

## 5. `SUPER_ADMIN` (Super Admin)

**Permissions:** every permission.

### 1. Onboarding
- Seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The app cannot create another one.

### 2. Active Functionality (`/admin/*`)
- **Analytics and reports:** dashboard, platform analytics with revenue, every report, the audit log and Web Vitals.
- **Orders, returns, shipping:** manage orders and parts, resolve disputed returns, retry refunds, configure zones and rates, record delivery.
- **Catalog:** create, approve, reject, archive and delete products; manage categories, tax rules, banners and review/Q&A moderation.
- **Assisted listing:** *Add product for a vendor* creates a draft for an approved vendor; every platform change is audited as `*_ON_BEHALF` and the vendor is emailed. *Submit for review on vendor's behalf* records how the vendor agreed (10 to 500 characters). Because the Super Admin prepared the listing, approving it needs a written reason (10 to 500 characters), recorded as `PRODUCT_APPROVED_OWN_WORK`. Changing the price, MRP, category, HSN code, COD option or variants of a live vendor product also needs a written reason.
- **Categories:** a move or commission change that alters GST or commission on live or pending vendor products needs a written reason, and the vendors are emailed.
- **Money:** payouts, commissions, wallet adjustments, gift cards, cashback offers, platform coupons.
- **Vendors and users:** approve, reject, suspend and delete stores; verify KYC; block or delete accounts; "log in as user" support sessions (never another super admin), with every action attributed to the Super Admin.
- **Support:** all support tickets and the bug-report queue; platform settings and notifications.

### 3. End of Lifecycle
- The sole Super Admin cannot delete their own account, and no one can delete or change a Super Admin through the app.

---

## 6. Development accounts

`npm run db:reset` creates 1 super admin, 100 vendors and 100 customers on random `@yopmail.com` addresses; see [TEST_CREDENTIALS.md](TEST_CREDENTIALS.md).
