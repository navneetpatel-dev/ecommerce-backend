# Cross-Role Data Visibility — Implementation Doc

**Problem this solves:** almost everything a customer sees (product, price, stock, rating, shipping estimate, review) actually originates from a vendor or admin decision, not the customer's own action. If a vendor gets suspended or a product gets unpublished, that needs to disappear from **every** customer-facing surface at once — search, category listings, the homepage, anyone's existing wishlist, anyone's existing cart — not just fail to load if someone clicks directly into its PDP. This doc defines the one rule that governs all of that, where it lives in the backend, and how the frontend handles the one genuinely tricky case: items a customer already has in their cart/wishlist before the vendor/product state changed.

---

## 1. The Core Rule (Define Once, Never Duplicate)

A product is **customer-visible** if and only if:

```
Product.status === 'LIVE'  AND  Vendor.status === 'APPROVED'
```

A review is **customer-visible** if and only if:

```
Review.status === 'APPROVED'  AND  the review's product is customer-visible (per above)
```

That's the entire rule. The bug this doc exists to prevent is this exact condition getting **reimplemented slightly differently** in five different queries (search, PLP, wishlist, cart, homepage) — which is how one of them ends up wrong. It's written **once**, as a Sequelize scope, and every query that returns customer-facing product/review data uses it.

**Explicit exception — admin and vendor dashboards do NOT use this rule.** A vendor must see their own `PENDING_APPROVAL`/`DRAFT`/`REJECTED` products in their dashboard, and admin must see everything to moderate it. This rule applies **only** to customer-facing endpoints. Section 5 covers exactly where the line is.

---

## 2. Backend: Centralizing the Rule

### 2.1 Sequelize Scope on `Product`

```ts
// database/models/product.model.ts — add to the existing model, doesn't change any existing fields
Product.addScope('customerVisible', {
  where: { status: 'LIVE' },
  include: [
    {
      model: Vendor,
      required: true,           // inner join — a product with no matching approved vendor is excluded, not nulled
      where: { status: 'APPROVED' },
      attributes: ['id', 'businessName', 'slug', 'logoUrl', 'commissionRate' /* only what customer views need */],
    },
  ],
});
```

Every customer-facing repository method uses `Product.scope('customerVisible')` instead of the bare `Product` model:

```ts
// src/modules/products/products.repository.ts
export class ProductsRepository extends BaseRepository<Product> {
  constructor() {
    super(Product); // BaseRepository's generic methods stay unscoped — used by admin/vendor code (Section 5)
  }

  findVisibleById(id: string) {
    return Product.scope('customerVisible').findByPk(id, { include: ['variants', 'images'] });
  }

  findVisibleList(filters: ProductFilters) {
    return Product.scope('customerVisible').findAndCountAll({ where: buildFilterWhere(filters), ...pagination(filters) });
  }
}
```

### 2.2 Search (Raw SQL — Section 7 of the Backend Doc)

The full-text search query already filters `status = 'LIVE'`; it needs the vendor join added explicitly, since raw SQL doesn't inherit the Sequelize scope automatically:

```sql
-- src/modules/search/search.repository.ts — updated WHERE clause
SELECT p.id, p.name, p."basePrice", ts_rank_cd(p.search_vector, query) AS rank
FROM products p
JOIN vendors v ON v.id = p.vendor_id
, websearch_to_tsquery('english', :term) query
WHERE p.search_vector @@ query
  AND p.status = 'LIVE'
  AND v.status = 'APPROVED'
  AND (:categoryId::uuid IS NULL OR p.category_id = :categoryId::uuid)
  -- ...remaining filters unchanged
ORDER BY rank DESC LIMIT :limit OFFSET :offset;
```

Same addition applies to the autocomplete query (backend Section 7.6) — a suspended vendor's product must not appear in search suggestions either.

### 2.3 Rating Aggregation (Reviews)

The `recalculateProductRating` function (backend Section 9.3) already only counts `Review.status = 'APPROVED'` — no change needed there, since a rating is only ever computed *for* a product that's already being viewed through the visible scope. The review **list** endpoint does need the join:

```ts
// src/modules/reviews/reviews.repository.ts
findVisibleForProduct(productId: string) {
  return Review.findAll({
    where: { productId, status: 'APPROVED' },
    include: [{ model: Product.scope('customerVisible'), required: true }],
  });
}
```

### 2.4 Homepage / Featured / Category Listings

Every one of these — trending products, admin-featured products, category listing, brand page (frontend doc Sections 5.1, 5.2, 5.5) — calls `productsRepository.findVisibleList()` / a query built on the same scope. There is no separate "featured products" query that bypasses it; "featured" is a filter *within* the visible set (`WHERE isFeatured = true`), never a parallel unscoped query.

---

## 3. The Hard Part: Items Already in a Cart or Wishlist

A product can become invisible *after* a customer has already added it to their cart or wishlist. This needs handling at **read-time**, not by silently filtering — a customer should see "this item is no longer available," not have it vanish with no explanation.

### 3.1 Hydration Returns an Availability Flag, Not a Filtered List

```ts
// src/modules/cart/cart.repository.ts
async getCartWithAvailability(cartId: string) {
  const cart = await Cart.findByPk(cartId, {
    include: [{
      model: CartItem,
      as: 'items',
      include: [{
        model: ProductVariant,
        include: [{ model: Product, include: [Vendor] }], // UNSCOPED — we need to see it even if hidden, to report why
      }],
    }],
  });

  return {
    ...cart.toJSON(),
    items: cart.items.map((item) => ({
      ...item.toJSON(),
      isAvailable: item.variant.product.status === 'LIVE' && item.variant.product.vendor.status === 'APPROVED' && item.variant.stock >= item.quantity,
      unavailableReason: resolveUnavailableReason(item.variant), // 'OUT_OF_STOCK' | 'PRODUCT_UNPUBLISHED' | 'VENDOR_UNAVAILABLE' | null
    })),
  };
}
```

Same pattern for wishlist hydration (`WishlistItem` → `Product`, unscoped read + computed `isAvailable`).

### 3.2 Checkout Hard-Blocks on Unavailable Items

The checkout service (backend Section 6.5) re-checks availability **at order-creation time**, not just trusting whatever the cart page last rendered — a vendor could be suspended in the seconds between page load and clicking "Place Order":

```ts
// src/modules/orders/checkout.service.ts — add before the existing transaction begins
export async function createOrderFromCart(cart: Cart, user: User, shippingAddress: Address, appliedCoupon?: Coupon) {
  const unavailable = await findUnavailableItems(cart); // same isAvailable logic as 3.1
  if (unavailable.length > 0) {
    throw new ValidationError({ code: 'ITEMS_UNAVAILABLE', items: unavailable });
  }
  // ...existing transaction logic unchanged
}
```

### 3.3 Historical Orders Are Never Affected

`OrderItem.productName` and `unitPrice` are **frozen snapshots taken at order time** (backend Section 4.4) — a customer's order history must keep showing what they actually bought and paid, regardless of what happens to the vendor/product afterward. Order history queries deliberately do **not** apply the `customerVisible` scope — this is the one place unscoped access to a since-hidden product is correct behavior, not a bug. Make this explicit in code with a comment, since it looks inconsistent with everything else in this doc unless you know why.

---

## 4. Vendor Reply on Reviews — One More Cross-Role Field

`Review.vendorReply` (add this column if not already present) is written by the vendor (`review.respond` permission) but displayed on the customer-facing review list. It follows the same visibility rule as the parent review — if the review itself isn't customer-visible, its vendor reply isn't either, since they're never shown independently of each other.

---

## 5. Where the Line Actually Is: Admin/Vendor vs. Customer Endpoints

| Endpoint | Scope used | Why |
|---|---|---|
| `GET /api/products` (public) | `customerVisible` | Customer-facing |
| `GET /api/products/:id` (public) | `customerVisible` | Customer-facing |
| `GET /api/vendor/products` | **Unscoped**, filtered by `vendorId` only (ownership, backend Section 6.2) | Vendor must see their own `DRAFT`/`PENDING_APPROVAL`/`REJECTED` products |
| `GET /api/admin/products?status=PENDING_APPROVAL` | **Unscoped**, admin sees everything to moderate | Admin's whole job here is looking at not-yet-visible products |
| `GET /api/admin/vendors?status=SUSPENDED` | **Unscoped** | Same reasoning |
| Search / autocomplete | `customerVisible` | Customer-facing |
| `GET /api/orders/:id` (order history, any role) | **Unscoped** (frozen snapshot, Section 3.3) | Historical accuracy overrides current visibility |

**Rule of thumb:** if the endpoint's audience is "anyone shopping," it uses the scope. If the audience is "the person who owns this or is moderating it," it uses ownership/role filtering instead — never the customer-visibility scope, since that would incorrectly hide a vendor's own pending work from themselves.

---

## 6. Frontend Handling

### 6.1 Cart & Wishlist — Render Unavailable Items Distinctly

Per the UI/UX design spec's Empty/Error state and badge patterns — an unavailable cart/wishlist item renders with a muted/grayscale treatment on its image, a status badge ("No longer available" / "Out of stock" / "Seller unavailable" depending on `unavailableReason`), and a "Remove" action — it does **not** silently disappear from the list, and it's **excluded from the cart total** while still visible in the list.

```tsx
// src/features/cart/components/CartLineItem.tsx
export function CartLineItem({ item }: { item: CartItemWithAvailability }) {
  const removeItem = useRemoveCartItem();

  return (
    <div className={item.isAvailable ? '' : 'opacity-50 grayscale'}>
      <ProductThumbnail product={item.variant.product} />
      <ProductInfo item={item} />
      {!item.isAvailable && <UnavailableBadge reason={item.unavailableReason} />}
      {item.isAvailable ? <QuantitySelector item={item} /> : <Button variant="ghost" onClick={() => removeItem.mutate(item.id)}>Remove</Button>}
    </div>
  );
}
```

### 6.2 Checkout — Block, Don't Silently Skip

The "Place Order" button is disabled (not hidden) with an inline message ("Remove unavailable items to continue") whenever any cart item's `isAvailable` is `false` — the checkout API call in Section 3.2 is the real enforcement; this is just matching UX to it so the customer isn't surprised by a 422 at the last step.

### 6.3 Everywhere Else

Search, PLP, category pages, homepage, autocomplete — **no frontend change needed**. They already just render whatever the API returns; since Section 2's scope is enforced server-side, a suspended vendor's products simply never appear in those responses in the first place.

---

## 7. Seed Data for Testing This

Add to `database/seeders/` — this scenario set needs to exist in every dev/test environment, since "vendor gets suspended after a customer already has the item in cart" is exactly the kind of edge case that never gets manually tested otherwise:

| Seed scenario | Expected result |
|---|---|
| Approved vendor, LIVE product | Visible everywhere (search, PLP, homepage, PDP) |
| Suspended vendor, LIVE product | Invisible everywhere, including search/autocomplete |
| Approved vendor, PENDING_APPROVAL product | Invisible to customers; visible in that vendor's own dashboard and admin's moderation queue |
| A test customer's cart containing an item from a vendor that gets suspended *after* the cart was created | Item shows in cart as unavailable (grayed, badged, excluded from total); checkout blocked until removed |
| A test customer's wishlist containing an item whose product later moves to `ARCHIVED` | Same unavailable treatment in wishlist |
| An `APPROVED` review on a product that is later unpublished | Review no longer appears on the (now-inaccessible) PDP; does not appear in any "recent reviews" admin/homepage widget either |
| A completed historical order containing a product from a now-suspended vendor | Order history still shows the original product name/price/vendor exactly as purchased — unaffected by the later suspension |

---

## 8. Verification Prompt (Use After Implementing)

```
Verify the customerVisible scope (Product.status = 'LIVE' AND Vendor.status = 'APPROVED') 
is actually applied, end to end, on every customer-facing surface: product list, product 
detail, search, autocomplete, homepage featured/trending, category pages, review lists, 
and rating aggregation. Confirm cart and wishlist hydration return isAvailable/
unavailableReason per item rather than filtering silently, and that checkout hard-blocks 
on any unavailable item at order-creation time, not just at the UI level. Confirm order 
history is correctly UNSCOPED (frozen snapshot) and does not regress to hiding past orders 
from suspended vendors. Confirm vendor and admin dashboards remain unscoped/ownership-
filtered and were not accidentally hidden by this change. Use the seed scenarios in this 
doc's Section 7 as the literal test cases — seed each one and check the actual API 
response and UI render for each, not just that the code compiles.
```

---

# Part 2 — The Remaining Gaps

Part 1 (Sections 1–8) fully covers the product → vendor → review chain. This part covers the four items that need the same "centralize once" treatment but weren't built out yet, plus two smaller fixes, plus one governing principle that should have been stated explicitly from the start.

## 9. Vendor Storefront Page Gating

Right now, individual products correctly disappear when a vendor is suspended (Part 1), but the vendor's own shop page (`/vendors/:slug`, reached via any "View shop" link) was never given the same treatment — it could currently render a technically-working page with zero products instead of a proper "unavailable" state.

### 9.1 Backend

```ts
// src/modules/vendors/vendors.service.ts
export async function getPublicVendorProfile(slug: string) {
  const vendor = await Vendor.findOne({ where: { slug, status: 'APPROVED' } }); // same condition as the customerVisible scope
  if (!vendor) throw new NotFoundError('Vendor'); // suspended, pending, and non-existent vendors are indistinguishable to the customer
  return vendor;
}
```

**Deliberately return a generic 404, not a 403 with a reason.** A customer (or a search engine, or an old bookmark) hitting a suspended vendor's page doesn't need to know *why* it's gone — "suspended for policy violation" is internal admin/audit information (backend Section 6.9's `AuditLog`), not something to leak publicly. This mirrors how Product's `NotFoundError` already behaves for unpublished products.

### 9.2 Frontend

```tsx
// src/features/vendors/VendorStorefrontPage.tsx
export function VendorStorefrontPage() {
  const { data: vendor, error } = useVendorProfile(slug);
  if (error?.code === 'NOT_FOUND') {
    return <ErrorState heading="This shop is currently unavailable" body="It may have closed or is temporarily paused." action={{ label: 'Browse other shops', href: '/vendors' }} />;
  }
  // ...normal storefront render
}
```

Uses the Error State pattern already defined in the UI/UX spec (Section 4.5) — not a broken page, not a raw 404, a proper on-brand unavailable state.

## 10. Vendor-Scoped Coupon Invalidation

`Coupon.vendorId` (backend Section 4.5) means a coupon can belong to one specific vendor. If that vendor is suspended, the coupon needs to stop working immediately — not just whenever it separately expires.

### 10.1 Fix: Check Live Vendor Status in the Validation Pipeline, Don't Mutate the Coupon

Add this as an explicit stage in the coupon engine's validation pipeline (backend Section 5.2), between "Status check" and "Date check":

```ts
// src/modules/coupons/couponEngine.ts
async function validateCoupon(coupon: Coupon, cart: Cart, user: User) {
  if (coupon.status !== 'ACTIVE') return invalid('COUPON_INACTIVE');

  if (coupon.vendorId) {
    const vendor = await Vendor.findByPk(coupon.vendorId);
    if (!vendor || vendor.status !== 'APPROVED') return invalid('VENDOR_UNAVAILABLE'); // live check, not a stored flag
  }

  // ...existing date/eligibility/usage-limit/cart-eligibility stages unchanged
}
```

**Deliberately a live check, not a stored/cached flag on the coupon** — if the vendor is later reinstated, the coupon works again automatically with no cleanup job needed. This is the same "single source of truth, checked live" philosophy as the `customerVisible` product scope in Part 1.

### 10.2 Already-Applied Coupons Need Re-Validation on Cart Change

A customer could apply a vendor-scoped coupon, then that vendor gets suspended *while the coupon is still sitting applied in their cart*. Cart totals need to re-run coupon validation any time the cart's effective contents change — including the *implicit* change of an item becoming unavailable (Part 1, Section 3.1), not just explicit add/remove actions:

```ts
// src/modules/cart/cart.service.ts
export async function recalculateCartTotals(cart: Cart) {
  const hydrated = await getCartWithAvailability(cart.id); // Part 1, Section 3.1

  if (cart.appliedCouponId) {
    const coupon = await Coupon.findByPk(cart.appliedCouponId);
    const result = await validateCoupon(coupon, hydrated, cart.user);
    if (!result.valid) {
      await cart.update({ appliedCouponId: null });
      return { ...hydrated, couponRemoved: { reason: result.reasonCode } }; // frontend surfaces this as a toast
    }
  }
  return hydrated;
}
```

### 10.3 Frontend

```tsx
// on any cart refetch that includes couponRemoved
if (cart.couponRemoved) {
  toast.info('Your coupon was removed', { description: describeReason(cart.couponRemoved.reason) });
}
```

## 11. Coupon Eligible-Set Pruning (Minimum Order Value Edge Case)

The main version of "does the coupon's scope still match visible items" is already handled for free: unavailable items are blocked at checkout (Part 1, Section 3.2), so a coupon can never actually apply against a phantom item. The one real remaining edge case is **`minOrderValue`**: if a cart's subtotal was computed including an item that then becomes unavailable, the subtotal drops — and a previously-valid coupon can fall below its `minOrderValue` threshold. Section 10.2's `recalculateCartTotals` already re-runs the full validation pipeline (which includes the `minOrderValue` check, backend Section 5.2 stage 5) on every effective cart change, so this is covered by the same fix — called out here explicitly so it's not missed as "just a coupon bug" if it's seen in isolation later.

## 12. Homepage Banner Lifecycle

Admin-owned promotional banners currently have no defined active/expiry state at all — a removed or expired banner would keep rendering indefinitely.

### 12.1 New Model

```ts
// database/models/promoBanner.model.ts
export class PromoBanner extends Model<InferAttributes<PromoBanner>, InferCreationAttributes<PromoBanner>> {
  declare id: CreationOptional<string>;
  declare title: string;
  declare imageUrl: string;
  declare linkType: 'PRODUCT' | 'CATEGORY' | 'VENDOR' | 'URL';
  declare linkTargetId: string | null; // productId/categoryId/vendorId depending on linkType
  declare linkUrl: string | null;      // used when linkType = 'URL'
  declare startDate: Date | null;      // null = active immediately
  declare endDate: Date | null;        // null = no expiry
  declare status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  declare priority: CreationOptional<number>;
}
```

### 12.2 Visibility Query

```ts
// src/modules/homepage/homepage.repository.ts
export async function getActiveBanners() {
  const now = new Date();
  const banners = await PromoBanner.findAll({
    where: {
      status: 'ACTIVE',
      [Op.and]: [
        { [Op.or]: [{ startDate: null }, { startDate: { [Op.lte]: now } }] },
        { [Op.or]: [{ endDate: null }, { endDate: { [Op.gte]: now } }] },
      ],
    },
    order: [['priority', 'DESC']],
  });

  // a banner linking to a since-unavailable product/vendor/category must not render as a dead link
  return filterAsync(banners, async (b) => b.linkType === 'URL' || (await isLinkTargetVisible(b.linkType, b.linkTargetId)));
}
```

`isLinkTargetVisible` reuses the exact same `customerVisible` scope check from Part 1 for `PRODUCT`/`VENDOR` targets, and the archived-check from Section 13 below for `CATEGORY` targets — one more place the same single rule gets reused rather than reimplemented.

## 13. Category Archival (Soft-Deactivate, Not Hard Delete)

### 13.1 Add a Status Field

```ts
// database/models/category.model.ts — add to existing model
declare status: 'ACTIVE' | 'ARCHIVED';
```

Customer-facing category listing/nav/filter queries filter `status: 'ACTIVE'`.

### 13.2 Explicit Rule: Archiving a Category Does NOT Cascade-Hide Its Products

This is the opposite of the vendor-suspension rule, and worth stating precisely so it isn't implemented by analogy incorrectly: if a category is archived, products under it **keep their own visibility** (governed entirely by `Product.status`/`Vendor.status`, per Part 1) — they simply stop being reachable via that category's browse/filter UI. They remain reachable via search, direct link, and homepage features. Admin gets a simple report (`GET /api/admin/categories/:id/product-count`) before archiving, to reassign products to another category if desired — but this is a manual admin workflow, not an automated cascade, since auto-reassigning to "some other category" would silently miscategorize products.

## 14. The Governing Principle (Stated Explicitly, Applies to Everything Above and Below)

Every piece of cross-role data in this system falls into exactly one of two buckets. Getting this distinction right is what prevents both kinds of bugs — hiding something that should stay visible, and showing something that should be hidden:

| Bucket | Rule | Examples |
|---|---|---|
| **Live pointer into the current catalog** — gated by current vendor/product/category state | Product listings, PDP, search, wishlist, cart, homepage banners, applied coupons, vendor storefront pages | If the underlying vendor/product/category state changes, this view must reflect that change immediately |
| **Record of something that already happened** — exempt, always shows the truth at the time it happened | Order history (Part 1, Section 3.3), shipment tracking, return request status, a customer's own submitted reviews on their "My Reviews" page, invoices | Never retroactively hidden or altered by a later vendor suspension/product change — the customer bought/reviewed/tracked something real, and that record stays accurate regardless of the catalog's current state |

**The one place this needs a small addition to Part 1's rule:** a customer's **own** review, viewed on their **own** "My Reviews" account page (frontend Section 5.13), is a personal-history surface — it should keep showing even if the product/vendor is later hidden from the public catalog. Only the **public**, PDP-attached review list (Part 1's original rule) is gated by current product visibility. Same underlying `Review` row, two different read paths with two different rules, exactly like Order History vs. live product browsing use the same `Product`/`Order` data with different scoping.

```ts
// src/modules/reviews/reviews.repository.ts
findOwnReviews(userId: string) {
  return Review.findAll({ where: { userId } }); // UNSCOPED — personal history, always accurate
}

findVisibleForProduct(productId: string) {
  return Review.findAll({
    where: { productId, status: 'APPROVED' },
    include: [{ model: Product.scope('customerVisible'), required: true }], // SCOPED — public catalog surface
  });
}
```

When in doubt about any new feature added later: ask "is this a receipt, or a live shop window?" — receipts don't change after the fact, shop windows reflect what's actually for sale right now.

---

## 15. Extended Seed Scenarios (Adds to Part 1, Section 7)

| Seed scenario | Expected result |
|---|---|
| Suspended vendor's storefront page, visited directly by URL | Returns the Error State ("shop unavailable"), not a broken empty-product-grid page |
| A vendor-scoped coupon, applied to a cart, then that vendor is suspended before checkout | Coupon auto-removed on next cart read, customer sees a toast explaining why |
| A cart with a coupon at exactly its `minOrderValue`, where one item then becomes unavailable | Coupon is re-validated and removed if the reduced subtotal now falls below the threshold |
| An active homepage banner linking to a product that is later unpublished | Banner stops appearing in `getActiveBanners()`, even though its own `status`/date range are still technically "active" |
| A category archived while it still has 40 LIVE products under it | Category disappears from nav/filters; all 40 products remain individually visible via search/direct link/homepage |
| A customer's own review on a product whose vendor is later suspended | Disappears from the public PDP; still appears on that customer's own "My Reviews" page |

## 16. Extended Verification Prompt (Supplements Part 1, Section 8)

```
Verify the four Part 2 gaps are closed: (1) a suspended vendor's storefront page returns 
a proper unavailable state, not an empty-but-technically-working page; (2) vendor-scoped 
coupons re-check live vendor status in the validation pipeline (not a cached flag) and 
already-applied coupons get invalidated with a customer-facing explanation when the 
vendor is suspended or the cart total falls below minOrderValue after an item becomes 
unavailable; (3) homepage banners respect status + date range AND stop rendering if their 
linked product/vendor/category is no longer visible/active; (4) archived categories 
disappear from nav/filters without cascading to hide the products underneath them. Also 
verify the personal-history exemption is correctly scoped narrowly: a customer's own 
"My Reviews" page shows all their reviews regardless of current product visibility, while 
the public PDP review list remains correctly gated — these must NOT both be either fully 
scoped or fully unscoped, they are deliberately different. Use Section 15's seed scenarios 
as literal test cases.
```
