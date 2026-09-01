# 📬 Postman Collection - E-Commerce Multi-Vendor Backend API

Complete, production-ready Postman collection for testing and developing with the E-Commerce Multi-Vendor Backend API.

**🎭 Organized by User Roles** for easy navigation and testing!

## 📁 Files in This Directory

| File | Description |
|------|-------------|
| `Ecommerce-Backend-Complete.postman_collection.json` | Complete API collection organized by roles (100 endpoints) |
| `Ecommerce-Backend-Dev.postman_environment.json` | Development environment variables |
| `generate-collection.py` | Python script to generate/extend the collection |
| `README.md` | This file - usage instructions |

## 🎭 Collection Structure (Role-Based)

The collection is organized into 5 role-based folders, with endpoints cleanly segregated by role permissions:

### Common (Public & Shared) - 13 endpoints
Accessible to all users or shared functionality:
- **System** - Health checks and monitoring
- **Authentication** - Login, register, password management
- **Search** - Product search and autocomplete
- **Notifications** - User notifications

### Customer (End Users) - 17 endpoints
Complete shopping and consumer experience:
- **Cart** - Shopping cart management
- **Checkout** - Place orders
- **Payments** - Payment processing
- **Wishlist** - Save favorite products
- **Wallet** - View balance and transactions
- **Returns** - Request returns and refunds

### Vendor (Merchants) - 16 endpoints
Merchant operations - create and manage own products:
- **Products** (10) - Create, update, delete own products, manage variants & images
- **SubOrders** (2) - Manage vendor-specific orders
- **Inventory** (2) - Track product stock levels
- **Reviews** (2) - View product reviews

### Admin (Order & Catalog Managers) - 18 endpoints
Administrative operations - approve and moderate:
- **Orders** (4) - Manage all orders and process refunds
- **Coupons** (4) - Create and manage discount coupons
- **Products** (6) - View and approve/reject vendor products
- **Reviews** (4) - View and moderate user reviews

### Super Admin (Full Control) - 36 endpoints
Platform administration and configuration:
- **Users** (6) - User management
- **Vendors** (11) - Vendor approval and management
- **Categories** (5) - Product category management
- **Shipping** (3) - Shipping zones and rates
- **Tax** (4) - Tax rules configuration
- **Commissions & Payouts** (5) - Vendor commission tracking
- **Admin** (2) - System settings and configuration

**📌 Note:** Each role folder contains ONLY endpoints relevant to that role. No cross-role endpoints to avoid confusion.

## 🚀 Quick Start

### 1. Import Collection and Environment

1. Open Postman
2. Click **Import** button
3. Drag and drop both JSON files:
   - `Ecommerce-Backend-Complete.postman_collection.json`
   - `Ecommerce-Backend-Dev.postman_environment.json`
4. Select the **E-Commerce Backend - Development** environment from the dropdown

### 2. Configure Base URL

The environment is pre-configured with:
- `baseUrl`: `http://localhost:3000`

**For Docker:**
```
baseUrl = http://localhost:3000
```

**For Local Development:**
```
baseUrl = http://localhost:3000
```

**For Production:**
```
baseUrl = https://your-api-domain.com
```

### 3. Verify API is Running

1. Open the collection
2. Navigate to **🔧 System → Health Check**
3. Click **Send**
4. You should see a 200 OK response with service statuses

### 4. Authenticate

**Available Test Credentials:**

**Super Admin** (after running `npm run db:seed`):
```
Email: admin@ecommerce.com
Password: Admin@123
```

**Customer** (register new):
```
Use: Common → Authentication → Register - Customer
```

**Vendor** (register and get approved):
```
1. Use: Super Admin → Vendors → Register Vendor
2. Then: Super Admin → Vendors → Approve Vendor (as admin)
3. Login with vendor credentials
```

**To Login:**
1. Navigate to **Common → Authentication → Login** (choose role)
2. Click **Send**
3. Tokens are **automatically stored** in environment variables
4. All subsequent requests will use these tokens automatically

### 5. Test by Role

Navigate to the folder matching your role and start testing!

## 🎯 Testing Flows by Role

### Customer Journey (Complete Shopping Flow)
```
1. Common → Authentication → Register Customer
2. Common → Authentication → Login - Customer
3. Customer → Products → Get All Products (browse)
4. Customer → Products → Get Product by ID (view details)
5. Customer → Cart → Add to Cart
6. Customer → Cart → Get My Cart
7. Customer → Checkout → Create Checkout
8. Customer → Orders → Get My Orders
9. Customer → Reviews → Create Review
10. Customer → Wishlist → Add to Wishlist
```

### Vendor Journey (Merchant Operations)
```
1. Super Admin → Vendors → Register Vendor Application
2. Super Admin → Vendors → Approve Vendor (switch to admin)
3. Common → Authentication → Login - Vendor
4. Customer → Products → Create Product
5. Customer → Products → Submit Product for Approval
6. Vendor → SubOrders → Get Vendor Sub-Orders
7. Vendor → Inventory → Get Low Stock Products
8. Super Admin → Commissions → Calculate Commission (admin approves)
```

### Admin Journey (Order & Coupon Management)
```
1. Common → Authentication → Login - Admin (Order Manager role)
2. Customer → Orders → Get All Orders (admin view)
3. Customer → Orders → Update Order Status
4. Admin → Coupons → Create Coupon
5. Admin → Coupons → Get All Coupons
6. Customer → Reviews → Get All Reviews (admin moderation)
```

### Super Admin Journey (Platform Management)
```
1. Common → Authentication → Login - Admin (Super Admin)
2. Super Admin → Users → Get All Users
3. Super Admin → Vendors → Get All Vendors
4. Super Admin → Vendors → Approve/Reject Vendor
5. Super Admin → Categories → Create Category
6. Super Admin → Shipping → Create Shipping Zone
7. Super Admin → Tax → Create Tax Rule
8. Super Admin → Commissions → View Commission Ledger
9. Super Admin → Payouts → Create Payout
```

## ✨ Features

### 🔄 Automatic Token Management

- ✅ Tokens are automatically stored after login/register
- ✅ Tokens are automatically sent with protected requests
- ✅ Tokens are automatically cleared on logout
- ✅ Collection-level auth configuration (Bearer token)

### 🧪 Comprehensive Tests

Every request includes tests for:
- ✅ HTTP status code validation
- ✅ Response time validation
- ✅ Response structure validation
- ✅ Automatic data extraction (IDs, tokens, etc.)
- ✅ Environment variable population

### 📝 Pre-request Scripts

Automatically generates:
- ✅ Current timestamp
- ✅ Random email addresses
- ✅ Random strings for testing
- ✅ Random numbers
- ✅ Token expiry checks

### 🎯 Test Data Generation

The collection automatically generates test data:

| Variable | Example | Usage |
|----------|---------|-------|
| `{{randomEmail}}` | `user7x3k@example.com` | User registration |
| `{{randomString}}` | `a7x3k9` | Unique identifiers |
| `{{randomNumber}}` | `4273` | Numeric test data |
| `{{timestamp}}` | `2026-08-03T12:00:00.000Z` | Timestamps |

### 📊 Environment Variables

All important values are stored as variables:

**Authentication:**
- `accessToken` - JWT access token (auto-stored)
- `refreshToken` - Refresh token (auto-stored)
- `userId` - Current user ID
- `userEmail` - Current user email
- `userRole` - Current user role

**Resources:**
- `vendorId`, `productId`, `categoryId`
- `orderId`, `cartId`, `paymentId`
- `couponId`, `reviewId`, `wishlistId`
- And more...

## 🎬 Running the Collection

### Option 1: Manual Testing

1. Select a request
2. Review the request description
3. Modify request body if needed
4. Click **Send**
5. Check the tests results

### Option 2: Collection Runner

Run all requests in sequence:

1. Click collection name
2. Click **Run** button
3. Select **E-Commerce Backend - Development** environment
4. Configure iterations (usually 1)
5. Click **Run E-Commerce Multi-Vendor Backend API**

The collection will execute all requests in order with proper data flow.

### Option 3: Newman (CLI)

Run from command line:

```bash
# Install Newman
npm install -g newman

# Run collection
newman run Ecommerce-Backend-Complete.postman_collection.json \
  -e Ecommerce-Backend-Dev.postman_environment.json \
  -r cli,html

# Run with specific folder
newman run Ecommerce-Backend-Complete.postman_collection.json \
  -e Ecommerce-Backend-Dev.postman_environment.json \
  --folder "Authentication"
```

## 🔧 Extending the Collection

The collection currently includes fully documented System and Authentication endpoints. To add more endpoints:

### Option 1: Manually in Postman

1. Right-click on a folder
2. Select **Add Request**
3. Configure method, URL, body, tests
4. Add documentation

### Option 2: Using the Python Script

1. Edit `generate-collection.py`
2. Add your endpoints using the helper functions
3. Run the script:
   ```bash
   python3 generate-collection.py
   ```

**Example:** Adding a new endpoint

```python
# In generate-collection.py, add to the appropriate section:
create_request(
    "Get User Profile",
    "GET",
    "/api/users/profile",
    "Get authenticated user's profile information.",
    tests=create_test_script(200, {"id": "userId"}),
    auth=True
)
```

## 📖 Request Documentation

Each request includes:

- **Purpose** - What the endpoint does
- **Authentication** - Whether auth is required
- **Required Fields** - What data must be sent
- **Optional Fields** - What data can be sent
- **Response Structure** - What to expect back
- **Example Responses** - Success and error examples
- **Usage Notes** - Important information
- **Related Endpoints** - Connected functionality

## 🧪 Testing Scenarios

### Positive Test Cases (Success Flows)

1. **User Registration Flow**
   - Register → Login → Get Profile → Update Profile

2. **Vendor Onboarding Flow**
   - Register Vendor → Upload Documents → Admin Approval

3. **Product Management Flow**
   - Create Product → Add Variants → Add Images → Submit for Approval

4. **Shopping Flow**
   - Browse Products → Add to Cart → Apply Coupon → Checkout → Place Order

5. **Order Management Flow**
   - Create Order → Process Payment → Update Status → Track Shipment

### Negative Test Cases (Error Handling)

The collection includes separate requests for testing error scenarios:

- ❌ Unauthorized access (missing token)
- ❌ Forbidden access (insufficient permissions)
- ❌ Validation failures (invalid data)
- ❌ Missing required fields
- ❌ Invalid IDs (non-existent resources)
- ❌ Duplicate resources
- ❌ Business rule violations

## 🎯 Best Practices

### 1. Always Start with Health Check

Before testing, verify the API is running:
```
🔧 System → Health Check
```

### 2. Authenticate First

Most endpoints require authentication:
```
🔐 Authentication → Login - Admin (or Register)
```

### 3. Use the Right Role

Different endpoints require different permissions:
- **Admin**: Full platform access
- **Vendor**: Product and order management
- **Customer**: Shopping and orders

### 4. Check Test Results

After each request, check the **Test Results** tab:
- ✅ Green checkmarks = passed
- ❌ Red X marks = failed

### 5. Use Variables

Don't hardcode values. Use variables for:
- Base URL
- Tokens
- Resource IDs
- Test data

### 6. Follow the Flow

Execute requests in logical order:
1. System check
2. Authentication
3. Resource creation
4. Resource operations
5. Resource deletion

## 🐛 Troubleshooting

### Issue: "Access token required"

**Solution:** Run a login request first:
```
🔐 Authentication → Login - Admin
```

### Issue: "Connection refused"

**Solution:** Verify the API is running:
```bash
# Check if Postgres + Redis are running
docker compose ps

# Or check local server
curl http://localhost:9000/health
```

### Issue: "Invalid credentials"

**Solution:** Ensure database is seeded:
```bash
npm run db:seed
```

### Issue: "Validation error"

**Solution:** Check request body against the schema in the request description.

### Issue: "Resource not found"

**Solution:** Ensure the resource was created first and the ID is stored in environment variables.

## 📊 Collection Metrics

After running the collection, you'll see:

- **Total Requests**: Number of endpoints tested
- **Passed Tests**: Green checkmarks
- **Failed Tests**: Issues found
- **Average Response Time**: Performance metrics

## 🔒 Security Notes

### Environment Variables

- Never commit environment files with real tokens
- Use different environments for dev/staging/production
- Keep `accessToken` and `refreshToken` as secret type

### Sensitive Data

- Don't hardcode API keys or passwords
- Use environment variables for all credentials
- Clear tokens after testing in shared environments

## 🤝 Contributing

To add more endpoints to the collection:

1. Fork the repository
2. Add endpoints to `generate-collection.py`
3. Run the generator script
4. Test the new endpoints
5. Submit a pull request

## 📞 Support

For issues or questions:

1. Check the API documentation
2. Review request descriptions in Postman
3. Check the project README
4. Open an issue on GitHub

## 📝 Version History

- **v1.0** (2026-08-03)
  - Initial collection with System and Authentication
  - Complete test coverage
  - Automatic token management
  - Environment setup
  - Documentation

---

**Happy Testing! 🚀**

For more information, see the main project [README.md](../README.md)
