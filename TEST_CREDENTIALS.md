# Test Credentials for E-Commerce Application

## Default Admin Account (Created by existing seeder)
- **Email**: admin@ecommerce.com
- **Password**: Admin@123 (or from ADMIN_PASSWORD env variable)
- **Role**: SUPER_ADMIN
- **Description**: Full system access - can manage all users, vendors, products, orders, settings

---

## Admin Accounts

### 1. Order Manager Admin
- **Email**: orderadmin@ecommerce.com
- **Password**: Test@123
- **Role**: ADMIN_ORDER_MANAGER
- **Permissions**: Manage orders, process refunds, view analytics
- **Description**: Specialized for order management, customer service, and refund processing

### 2. Catalog Manager Admin
- **Email**: catalogadmin@ecommerce.com
- **Password**: Test@123
- **Role**: ADMIN_CATALOG_MANAGER
- **Permissions**: Manage products, approve vendor products, manage categories, moderate reviews
- **Description**: Specialized for product catalog management and vendor product approvals

---

## Vendor Owner Accounts (22 Approved + 3 Pending)

All vendor passwords: **Test@123**

### Approved Vendors (Can sell products immediately)

1. **TechWorld**
   - Email: owner@techworld.com
   - Status: APPROVED
   - Products: Electronics, gadgets
   - Commission Rate: Variable

2. **FashionHub**
   - Email: owner@fashionhub.com
   - Status: APPROVED
   - Products: Clothing, fashion accessories

3. **HomeStyle**
   - Email: owner@homestyle.com
   - Status: APPROVED
   - Products: Home decor, furniture

4. **SportsPro**
   - Email: owner@sportspro.com
   - Status: APPROVED
   - Products: Sports equipment, fitness gear

5. **BeautyBoutique**
   - Email: owner@beautyboutique.com
   - Status: APPROVED
   - Products: Beauty products, cosmetics

6. **BookStore**
   - Email: owner@bookstore.com
   - Status: APPROVED
   - Products: Books, educational materials

7. **ToyLand**
   - Email: owner@toyland.com
   - Status: APPROVED
   - Products: Toys, games

8. **FoodMart**
   - Email: owner@foodmart.com
   - Status: APPROVED
   - Products: Food, snacks, beverages

9. **AutoZone**
   - Email: owner@autozone.com
   - Status: APPROVED
   - Products: Automotive parts, accessories

10. **JewelCraft**
    - Email: owner@jewelcraft.com
    - Status: APPROVED
    - Products: Jewelry, watches

11. **GadgetGalaxy**
    - Email: owner@gadgetgalaxy.com
    - Status: APPROVED

12. **StyleSavvy**
    - Email: owner@stylesavvy.com
    - Status: APPROVED

13. **DecorDen**
    - Email: owner@decorden.com
    - Status: APPROVED

14. **FitnessFlex**
    - Email: owner@fitnessflex.com
    - Status: APPROVED

15. **GlamourGoods**
    - Email: owner@glamourgoods.com
    - Status: APPROVED

16. **PageTurner**
    - Email: owner@pageturner.com
    - Status: APPROVED

17. **PlayZone**
    - Email: owner@playzone.com
    - Status: APPROVED

18. **GourmetGrove**
    - Email: owner@gourmetgrove.com
    - Status: APPROVED

19. **CarCare**
    - Email: owner@carcare.com
    - Status: APPROVED

20. **GemGallery**
    - Email: owner@gemgallery.com
    - Status: APPROVED

21. **ElectroShop**
    - Email: owner@electroshop.com
    - Status: APPROVED

22. **TrendyThreads**
    - Email: owner@trendythreads.com
    - Status: APPROVED

### Pending Approval Vendors (Need admin approval to sell)

23. **CozyCorner**
    - Email: owner@cozycorner.com
    - Status: PENDING
    - Description: Test vendor approval workflow

24. **ActiveLife**
    - Email: owner@activelife.com
    - Status: PENDING

25. **PureBeauty**
    - Email: owner@purebeauty.com
    - Status: PENDING

---

## Vendor Staff Accounts

Each vendor has a staff account with limited permissions (can update products, manage orders but cannot create/delete products or request payouts).

Staff emails follow pattern: **staff@{vendorname}.com**
All passwords: **Test@123**

Examples:
- staff@techworld.com
- staff@fashionhub.com
- staff@homestyle.com
- (... and 22 more)

---

## Customer Accounts (100 customers)

All customer passwords: **Test@123**

### Sample Customer Accounts

1. **customer1@example.com** - Has orders, reviews, cart items, wishlist
2. **customer2@example.com** - Has orders, wallet balance
3. **customer3@example.com** - Has active cart and wishlist
4. **customer4@example.com** - Has order history
5. **customer5@example.com** - Has wallet transactions
...
100. **customer100@example.com**

**Note**: Customers 1-40 have wallet transactions, 1-50 have active carts, 1-60 have wishlists

---

## Test Scenarios by Role

### Super Admin Testing (`admin@ecommerce.com`)
- ✅ View all dashboard analytics
- ✅ Approve/reject pending vendors (CozyCorner, ActiveLife, PureBeauty)
- ✅ Approve/reject pending products (20 products with PENDING status)
- ✅ Manage all users, roles, and permissions
- ✅ View commission ledgers and process payouts
- ✅ Manage coupons (20 active/inactive coupons available)
- ✅ View audit logs and system analytics
- ✅ Manage shipping zones and rates
- ✅ Configure platform settings

### Order Manager Admin Testing (`orderadmin@ecommerce.com`)
- ✅ View all orders (200 orders across different statuses)
- ✅ Process refunds and returns (return requests available)
- ✅ Update order statuses
- ✅ View shipment tracking information
- ✅ Handle customer service issues
- ❌ Cannot manage products or vendors

### Catalog Manager Admin Testing (`catalogadmin@ecommerce.com`)
- ✅ Approve/reject vendor products
- ✅ Manage product categories (50+ categories)
- ✅ Moderate product reviews (300 reviews available)
- ✅ View product analytics
- ❌ Cannot manage orders or process refunds

### Vendor Owner Testing (e.g., `owner@techworld.com`)
- ✅ View vendor dashboard and analytics
- ✅ Create, update, delete own products
- ✅ Manage product inventory and variants
- ✅ View and manage sub-orders
- ✅ View commission earnings
- ✅ Request payouts
- ✅ Respond to product reviews
- ✅ Upload product images
- ❌ Cannot see other vendors' data

### Vendor Staff Testing (e.g., `staff@techworld.com`)
- ✅ Update existing products (price, stock, description)
- ✅ Manage sub-orders (update status, tracking)
- ✅ View vendor analytics
- ❌ Cannot create or delete products
- ❌ Cannot request payouts or view commission details

### Customer Testing (e.g., `customer1@example.com`)
- ✅ Browse products (500 products across 50+ categories)
- ✅ Search and filter products
- ✅ Add items to cart
- ✅ Add items to wishlist
- ✅ Apply coupons (20 coupons available, codes like WELCOME10, SAVE20, etc.)
- ✅ Place orders with multiple payment methods (COD, Razorpay, Wallet)
- ✅ Track orders and shipments
- ✅ Write and vote on reviews
- ✅ Request returns/refunds
- ✅ Manage wallet balance
- ✅ View order history
- ✅ Manage multiple addresses

---

## Data Statistics

- **Categories**: 50 (8 parent categories with subcategories)
- **Vendors**: 25 (22 approved, 3 pending)
- **Products**: 500 (480 approved, 20 pending moderation)
- **Product Variants**: ~1000
- **Product Images**: ~1500
- **Orders**: 200 (various statuses: pending, confirmed, shipped, delivered, cancelled)
- **Sub-Orders**: ~400
- **Order Items**: ~1200
- **Reviews**: 300 with votes
- **Coupons**: 20 (15 active, 5 inactive)
- **Active Carts**: 50 with items
- **Wishlists**: 60 with items
- **Wallet Transactions**: ~200
- **Return Requests**: ~20
- **Shipments**: ~150
- **Commission Ledgers**: ~150
- **Payouts**: 30 (pending, approved, completed)

---

## Active Coupon Codes (First 15 are active)

1. **WELCOME10** - 10% discount for new users
2. **SAVE20** - 20% off
3. **SUMMER25** - 25% summer sale
4. **FLASH50** - 50% flash sale
5. **FIRSTORDER** - First order discount
6. **LOYALTY15** - 15% loyalty discount
7. **MEGA30** - 30% mega sale
8. **CLEARANCE40** - 40% clearance
9. **VIP25** - 25% VIP discount
10. **SPECIAL35** - 35% special offer
11. **NEWUSER20** - 20% for new users
12. **RETURN10** - 10% returning customer
13. **BULK15** - 15% bulk purchase
14. **HOLIDAY50** - 50% holiday sale
15. **WEEKEND20** - 20% weekend deal

---

## Testing Workflows

### Complete Purchase Flow
1. Login as customer1@example.com
2. Browse products by category
3. Add 3-5 products to cart
4. Apply coupon code (e.g., WELCOME10)
5. Proceed to checkout
6. Select/add shipping address
7. Choose shipping method
8. Complete payment (COD/Razorpay/Wallet)
9. View order confirmation
10. Track shipment

### Vendor Product Management
1. Login as owner@techworld.com
2. View vendor dashboard and analytics
3. Create new product with variants
4. Upload product images
5. Manage inventory
6. View sub-orders
7. Update order status
8. Request payout
9. Respond to customer reviews

### Admin Vendor Approval
1. Login as admin@ecommerce.com
2. Navigate to vendor approval queue
3. Review pending vendor: CozyCorner
4. Verify documents
5. Approve or reject vendor
6. Notify vendor of decision

### Admin Product Moderation
1. Login as catalogadmin@ecommerce.com
2. View pending products queue (20 products)
3. Review product details
4. Approve or reject products
5. Manage product categories

### Return/Refund Processing
1. Login as customer with delivered order
2. Request return for order item
3. Login as orderadmin@ecommerce.com
4. Review return request
5. Approve/reject return
6. Process refund

---

## Image URLs

All product and category images use stable Unsplash URLs that are publicly accessible and will not break. Images are categorized by product type (electronics, fashion, home, etc.) for realistic visual representation.

---

## Environment Setup

To seed the database, run:

```bash
cd backend
npm run db:seed:all
```

Or to run this specific seeder:

```bash
npx sequelize-cli db:seed --seed 20240101000003-comprehensive-seed.js
```

To undo all seeds:

```bash
npm run db:seed:undo:all
```

---

## Notes

- All passwords are set to **Test@123** for testing convenience
- Email verification is enabled for all users
- Marketing consent varies by customer
- Order dates are distributed across the last 90 days for realistic data
- Products have varying stock levels (10-1000 units)
- Commission rates vary by vendor (5-15%)
- Shipping costs are standardized at $5.99 per sub-order
- Multiple payment methods are represented in orders
- Return requests exist for ~10% of delivered orders
- Reviews have ratings from 3-5 stars
- Wallet balances are maintained with proper credit/debit tracking

---

**For production deployment, ensure all passwords are changed and use strong, unique credentials!**
