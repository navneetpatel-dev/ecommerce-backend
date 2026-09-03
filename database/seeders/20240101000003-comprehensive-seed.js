'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const {
  MIN_PRODUCT_GALLERY_IMAGES,
  buildGalleryUrls,
} = require('./lib/product-gallery-images');

// Stable image URLs using picsum.photos (reliable, always available)
const CATEGORY_COVERS = {
  electronics: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=400&fit=crop',
  fashion: 'https://images.unsplash.com/photo-1441986304907-64674bd600d8?w=400&fit=crop',
  home: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=400&fit=crop',
  sports: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=400&fit=crop',
  beauty: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&fit=crop',
  books: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=400&fit=crop',
  toys: 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=400&fit=crop',
  food: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=400&fit=crop',
  automotive: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=400&fit=crop',
  jewelry: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=400&fit=crop',
};

const VENDOR_LOGOS = [
  'https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?w=200&fit=crop',
  'https://images.unsplash.com/photo-1572044162444-ad60f128bdea?w=200&fit=crop',
  'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=200&fit=crop',
  'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=200&fit=crop',
  'https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=200&fit=crop',
];

const PRODUCT_IMAGES = {
  electronics: [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&fit=crop',
    'https://images.unsplash.com/photo-1484788984921-03950022c9ef?w=600&fit=crop',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&fit=crop',
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&fit=crop',
    'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=600&fit=crop',
  ],
  fashion: [
    'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&fit=crop',
    'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=600&fit=crop',
    'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=600&fit=crop',
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&fit=crop',
    'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=600&fit=crop',
  ],
  home: [
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&fit=crop',
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&fit=crop',
    'https://images.unsplash.com/photo-1538688525198-9b88f6f53126?w=600&fit=crop',
    'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=600&fit=crop',
    'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=600&fit=crop',
  ],
  sports: [
    'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=600&fit=crop',
    'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=600&fit=crop',
    'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=600&fit=crop',
    'https://images.unsplash.com/photo-1530549387789-4c1017266635?w=600&fit=crop',
    'https://images.unsplash.com/photo-1627483298428-03a2c310a14f?w=600&fit=crop',
  ],
  beauty: [
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600&fit=crop',
    'https://images.unsplash.com/photo-1570194065650-d99fb4d8a609?w=600&fit=crop',
    'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=600&fit=crop',
    'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600&fit=crop',
    'https://images.unsplash.com/photo-1526947425960-945c6e72858f?w=600&fit=crop',
  ],
  books: [
    'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&fit=crop',
    'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600&fit=crop',
    'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=600&fit=crop',
    'https://images.unsplash.com/photo-1526243741027-444d633d7365?w=600&fit=crop',
    'https://images.unsplash.com/photo-1519682337058-a94d519337bc?w=600&fit=crop',
  ],
  toys: [
    'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=600&fit=crop',
    'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=600&fit=crop',
    'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=600&fit=crop',
    'https://images.unsplash.com/photo-1576670159805-381ae21d34c2?w=600&fit=crop',
    'https://images.unsplash.com/photo-1559511260-66a3e7f2f8a2?w=600&fit=crop',
  ],
  food: [
    'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=600&fit=crop',
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&fit=crop',
    'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&fit=crop',
    'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&fit=crop',
    'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&fit=crop',
  ],
  automotive: [
    'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=600&fit=crop',
    'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=600&fit=crop',
    'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=600&fit=crop',
    'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&fit=crop',
    'https://images.unsplash.com/photo-1494905998402-395d579af36f?w=600&fit=crop',
  ],
  jewelry: [
    'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=600&fit=crop',
    'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=600&fit=crop',
    'https://images.unsplash.com/photo-1599643478518-a3c4e2e36301?w=600&fit=crop',
    'https://images.unsplash.com/photo-1601121141461-9d6647bca1ed?w=600&fit=crop',
    'https://images.unsplash.com/photo-1573408301185-9146fe634ad0?w=600&fit=crop',
  ],
};

const DEFAULT_IMAGES = PRODUCT_IMAGES.electronics;

function randomElement(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomPrice(min, max) { return parseFloat((Math.random() * (max - min) + min).toFixed(2)); }
function slugify(str) { return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const passwordHash = await bcrypt.hash('Test@123', 12);

    // ─── ROLES ────────────────────────────────────────────────
    console.log('Checking roles...');
    const roleNames = ['SUPER_ADMIN', 'ADMIN_ORDER_MANAGER', 'ADMIN_CATALOG_MANAGER', 'VENDOR_OWNER', 'VENDOR_STAFF', 'CUSTOMER'];
    const existingRoles = await queryInterface.sequelize.query(
      `SELECT name FROM roles`, { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    const existingRoleNames = existingRoles.map(r => r.name);
    const missingRoles = roleNames.filter(name => !existingRoleNames.includes(name));
    if (missingRoles.length > 0) {
      await queryInterface.bulkInsert('roles', missingRoles.map(name => ({
        id: uuidv4(), name, createdAt: now, updatedAt: now
      })));
      console.log(`✓ Created ${missingRoles.length} missing roles`);
    }
    const roles = await queryInterface.sequelize.query(
      `SELECT id, name FROM roles`, { type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    const roleMap = {};
    roles.forEach(r => { roleMap[r.name] = r.id; });

    // ─── CATEGORIES ───────────────────────────────────────────
    console.log('Creating categories...');
    const categories = [];
    const categoryNames = {
      electronics: ['Laptops', 'Smartphones', 'Tablets', 'Cameras', 'Audio', 'Gaming', 'Wearables', 'Accessories'],
      fashion: ['Men Clothing', 'Women Clothing', 'Kids Clothing', 'Shoes', 'Bags', 'Watches', 'Sunglasses', 'Jackets'],
      home: ['Furniture', 'Kitchen', 'Bedding', 'Decor', 'Lighting', 'Storage', 'Garden', 'Tools'],
      sports: ['Fitness', 'Outdoor', 'Team Sports', 'Cycling', 'Yoga', 'Swimming'],
      beauty: ['Skincare', 'Makeup', 'Haircare', 'Fragrances', 'Bath & Body'],
      books: ['Fiction', 'Non-Fiction', 'Children', 'Educational', 'Comics'],
      toys: ['Action Figures', 'Dolls', 'Building Blocks', 'Educational', 'Board Games'],
      food: ['Snacks', 'Beverages', 'Organic', 'Gourmet', 'Health Foods'],
      automotive: ['Car Parts', 'Motorcycle', 'Accessories', 'Electronics', 'Tools'],
      jewelry: ['Necklaces', 'Earrings', 'Bracelets', 'Rings', 'Watches'],
    };
    const allLeaves = [];
    for (const [parent, children] of Object.entries(categoryNames)) {
      const parentId = uuidv4();
      categories.push({ id: parentId, name: parent.charAt(0).toUpperCase() + parent.slice(1), slug: parent, imageUrl: CATEGORY_COVERS[parent], parentId: null, createdAt: now, updatedAt: now });
      for (const child of children) {
        const leaf = { id: uuidv4(), name: child, slug: `${parent}-${slugify(child)}`, imageUrl: CATEGORY_COVERS[parent], parentId, createdAt: now, updatedAt: now };
        categories.push(leaf);
        allLeaves.push(leaf);
      }
    }
    await queryInterface.bulkInsert('categories', categories);
    console.log(`✓ Created ${categories.length} categories`);

    // ─── VENDORS (25) ────────────────────────────────────────
    console.log('Creating vendors...');
    const vendors = [];
    const vendorOwners = [];
    const vendorStaff = [];
    const vendorDocuments = [];
    const vendorNames = [
      'TechWorld', 'FashionHub', 'HomeStyle', 'SportsPro', 'BeautyBoutique',
      'BookNook', 'ToyLand', 'FoodMart', 'AutoZone', 'JewelCraft',
      'GadgetGalaxy', 'StyleSavvy', 'DecorDen', 'FitnessFlex', 'GlamourGoods',
      'PageTurner', 'PlayZone', 'GourmetGrove', 'CarCare', 'GemGallery',
      'ElectroShop', 'TrendyThreads', 'CozyCorner', 'ActiveLife', 'PureBeauty',
    ];
    for (let i = 0; i < 25; i++) {
      const vendorId = uuidv4();
      const approved = i < 22;
      const vendorStates = ['Karnataka', 'Maharashtra', 'Delhi', 'Tamil Nadu', 'Gujarat'];
      vendors.push({
        id: vendorId, businessName: vendorNames[i], slug: slugify(vendorNames[i]),
        gstNumber: `29AABC${String(i).padStart(4, '0')}N1Z${i + 1}`,
        state: vendorStates[i % vendorStates.length],
        bankDetails: JSON.stringify({ accountNumber: `000${String(i).padStart(12, '0')}`, ifscCode: `SBIN00${String(i).padStart(4, '0')}`, accountHolderName: vendorNames[i], bankName: 'State Bank of India' }),
        logoUrl: VENDOR_LOGOS[i % VENDOR_LOGOS.length], bannerUrl: null,
        description: `${vendorNames[i]} — premium quality products with fast shipping.`,
        status: approved ? 'APPROVED' : 'PENDING',
        entityType: 'SOLE_PROPRIETORSHIP',
        commissionRate: randomInt(8, 18), performanceScore: parseFloat((Math.random() * 3 + 2).toFixed(2)),
        createdAt: now, updatedAt: now,
      });
      vendorOwners.push({
        id: uuidv4(), email: `owner@${slugify(vendorNames[i])}.com`, passwordHash,
        name: `${vendorNames[i]} Owner`, phone: `+91987${String(i * 7 + 1).padStart(6, '0')}`,
        status: 'ACTIVE', roleId: roleMap.VENDOR_OWNER, vendorId,
        emailVerified: true, emailMarketingConsent: false, emailSuppressed: false,
        createdAt: now, updatedAt: now,
      });
      vendorStaff.push({
        id: uuidv4(), email: `staff@${slugify(vendorNames[i])}.com`, passwordHash,
        name: `${vendorNames[i]} Staff`, phone: `+91987${String(i * 7 + 2).padStart(6, '0')}`,
        status: 'ACTIVE', roleId: roleMap.VENDOR_STAFF, vendorId,
        emailVerified: true, emailMarketingConsent: false, emailSuppressed: false,
        createdAt: now, updatedAt: now,
      });
      for (const docType of [
        'GST_CERT',
        'PAN',
        'AADHAAR',
        'BANK_PROOF',
        'ADDRESS_PROOF',
        'AUTHORIZED_SIGNATORY_ID',
      ]) {
        vendorDocuments.push({
          id: uuidv4(), vendorId, type: docType, url: `https://docs.example.com/${docType.toLowerCase()}_${slugify(vendorNames[i])}.pdf`,
          verified: approved, createdAt: now, updatedAt: now,
        });
      }
    }
    await queryInterface.bulkInsert('vendors', vendors);
    await queryInterface.bulkInsert('users', [...vendorOwners, ...vendorStaff]);
    await queryInterface.bulkInsert('vendor_documents', vendorDocuments);
    const approvedVendors = vendors.filter(v => v.status === 'APPROVED');
    console.log(`✓ Created ${vendors.length} vendors with owners, staff, and documents`);

    // ─── ADMIN USERS ─────────────────────────────────────────
    console.log('Creating admin users...');
    // SUPER_ADMIN created by separate seeder (admin@ecommerce.com / Admin@123)
    const adminUsers = [
      { id: uuidv4(), email: 'ordermanager@ecommerce.com', passwordHash, name: 'Order Manager', phone: '+919876543210', status: 'ACTIVE', roleId: roleMap.ADMIN_ORDER_MANAGER, vendorId: null, emailVerified: true, emailMarketingConsent: false, emailSuppressed: false, createdAt: now, updatedAt: now },
      { id: uuidv4(), email: 'catalogmanager@ecommerce.com', passwordHash, name: 'Catalog Manager', phone: '+919876543211', status: 'ACTIVE', roleId: roleMap.ADMIN_CATALOG_MANAGER, vendorId: null, emailVerified: true, emailMarketingConsent: false, emailSuppressed: false, createdAt: now, updatedAt: now },
    ];
    const adminIds = adminUsers.map(u => u.id);
    await queryInterface.bulkInsert('users', adminUsers);
    console.log(`✓ Created ${adminUsers.length} admin users`);

    // ─── CUSTOMERS (100) + ADDRESSES ─────────────────────────
    console.log('Creating customers...');
    const customers = [];
    const addresses = [];
    const firstNames = ['Rahul', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Ananya', 'Deepak', 'Kavita', 'Raj', 'Meera', 'Arjun', 'Divya', 'Suresh', 'Lakshmi', 'Karan', 'Pooja', 'Nikhil', 'Neha', 'Rohit', 'Shreya'];
    const lastNames = ['Sharma', 'Patel', 'Kumar', 'Singh', 'Verma', 'Gupta', 'Reddy', 'Nair', 'Das', 'Joshi'];
    const cities = ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow'];
    const states = ['Maharashtra', 'Delhi', 'Karnataka', 'Telangana', 'Tamil Nadu', 'West Bengal', 'Maharashtra', 'Gujarat', 'Rajasthan', 'Uttar Pradesh'];
    const localities = ['Main Road', 'Church Street', 'MG Road', 'Park Avenue', 'Lake View', 'Gandhi Nagar', 'Patel Colony', 'Market Road', 'Station Road', 'Jubilee Hills'];

    for (let i = 0; i < 100; i++) {
      const customerId = uuidv4();
      const firstName = i === 54 ? 'Amit' : randomElement(firstNames);
      const lastName = i === 54 ? 'Gupta' : randomElement(lastNames);
      const email =
        i === 54
          ? 'amit.gupta54@example.com'
          : `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;
      customers.push({
        id: customerId, email, passwordHash,
        name: `${firstName} ${lastName}`, phone: `+91987${String(i).padStart(7, '0')}`,
        status: 'ACTIVE', roleId: roleMap.CUSTOMER, vendorId: null,
        emailVerified: true, emailMarketingConsent: i % 3 === 0, emailSuppressed: false,
        createdAt: now, updatedAt: now,
      });
      const numAddresses = randomInt(1, 3);
      for (let j = 0; j < numAddresses; j++) {
        const cityIdx = randomInt(0, cities.length - 1);
        addresses.push({
          id: uuidv4(), userId: customerId,
          line1: `${randomInt(1, 999)} ${randomElement(localities)}`,
          line2: j > 0 ? `Flat ${randomInt(1, 500)}` : null,
          city: cities[cityIdx], state: states[cityIdx], pincode: `${randomInt(10, 99)}${String(randomInt(100, 999)).padStart(3, '0')}`, country: 'India',
          isDefault: j === 0, createdAt: now, updatedAt: now,
        });
      }
    }
    await queryInterface.bulkInsert('users', customers);
    await queryInterface.bulkInsert('addresses', addresses);
    console.log(`✓ Created ${customers.length} customers with ${addresses.length} addresses`);

    // ─── SHIPPING ZONES & RATES ─────────────────────────────
    console.log('Creating shipping zones and rates...');
    const shippingZones = [];
    const shippingRates = [];
    const zoneData = [
      { name: 'Metro', pincodePrefixes: ['11', '40', '50', '60', '70', '34', '38', '44', '45', '56', '22'] },
      { name: 'Tier-1', pincodePrefixes: ['12', '13', '14', '20', '21', '30', '36', '39', '41', '47'] },
      { name: 'Tier-2', pincodePrefixes: ['15', '16', '17', '18', '23', '24', '25', '31', '32', '33'] },
      { name: 'Rest-India', pincodePrefixes: ['26', '27', '28', '29', '35', '37', '42', '43', '46', '48'] },
    ];
    for (const zone of zoneData) {
      const zoneId = uuidv4();
      shippingZones.push({ id: zoneId, name: zone.name, states: ['ALL'], pincodePrefixes: zone.pincodePrefixes, createdAt: now, updatedAt: now });
      for (const vendor of approvedVendors.slice(0, 20)) {
        for (let m = 0; m < 2; m++) {
          shippingRates.push({
            id: uuidv4(), vendorId: vendor.id, zoneId,
            method: m === 0 ? 'STANDARD' : 'EXPRESS',
            minWeightGrams: 0, maxWeightGrams: m === 0 ? 15000 : 8000,
            price: m === 0 ? randomPrice(40, 99) : randomPrice(99, 249),
            estimatedDays: m === 0 ? randomInt(5, 8) : randomInt(1, 3),
            freeShippingThreshold: m === 0 ? 499 : 999,
            createdAt: now, updatedAt: now,
          });
        }
      }
    }
    await queryInterface.bulkInsert('shipping_zones', shippingZones);
    await queryInterface.bulkInsert('shipping_rates', shippingRates);
    console.log(`✓ Created ${shippingZones.length} shipping zones with ${shippingRates.length} rates`);

    // ─── PRODUCTS (500) + VARIANTS + IMAGES ──────────────────
    console.log('Creating products (this may take a moment)...');
    const products = [];
    const productVariants = [];
    const productImages = [];
    const categoryParentMap = {};
    for (const c of allLeaves) categoryParentMap[c.id] = Object.keys(categoryNames).find(k => categories.find(pc => pc.id === c.parentId && pc.slug === k)) || 'electronics';

    for (let i = 0; i < 500; i++) {
      const productId = uuidv4();
      const leafCat = randomElement(allLeaves);
      const vendor = randomElement(approvedVendors);
      const basePrice = randomPrice(49, 2999);
      const isLive = i < 470;
      const status = isLive ? 'LIVE' : 'PENDING_APPROVAL';

      products.push({
        id: productId, vendorId: vendor.id, categoryId: leafCat.id,
        name: `${leafCat.name} ${randomElement(['Pro', 'Elite', 'Max', 'Ultra', 'Classic', 'Premium', 'Essential', 'Plus'])} ${i + 1}`,
        slug: `product-${i + 1}-${slugify(leafCat.name)}`, description: `Premium ${leafCat.name.toLowerCase()} crafted with the finest materials. Designed for durability and everyday use. Perfect for gifting or personal use.`,
        basePrice, status, approvedById: isLive ? roleMap.SUPER_ADMIN : null, rejectionNote: null,
        tags: [leafCat.name, 'Featured', 'In Stock'], avgRating: parseFloat((Math.random() * 2 + 3).toFixed(2)),
        createdAt: now, updatedAt: now,
      });

      // 1–3 variants
      const numVariants = randomInt(1, 3);
      const attrTypes = ['Size', 'Color', 'Material'];
      const attrValues = [['S', 'M', 'L', 'XL'], ['Red', 'Blue', 'Black', 'White', 'Green'], ['Cotton', 'Leather', 'Metal', 'Plastic']];
      for (let v = 0; v < numVariants; v++) {
        const variantPrice = Math.round((basePrice + v * randomInt(50, 300)) * 100) / 100;
        productVariants.push({
          id: uuidv4(), productId,
          sku: `SKU-${String(i + 1).padStart(5, '0')}-V${v + 1}`,
          price: variantPrice, stock: randomInt(isLive ? 10 : 0, isLive ? 500 : 0), lowStockAt: 5,
          attributes: JSON.stringify({ [attrTypes[v % 3]]: randomElement(attrValues[v % 3]) }),
          createdAt: now, updatedAt: now,
        });
      }

      // Gallery images (12 per product for PDP testing)
      const catKey = categoryParentMap[leafCat.id] || 'electronics';
      const imgs = buildGalleryUrls(catKey, productId, MIN_PRODUCT_GALLERY_IMAGES);
      for (let img = 0; img < imgs.length; img++) {
        productImages.push({
          id: uuidv4(), productId, url: imgs[img],
          isPrimary: img === 0, createdAt: now, updatedAt: now,
        });
      }
      if ((i + 1) % 100 === 0) console.log(`  Created ${i + 1}/500 products...`);
    }
    await queryInterface.bulkInsert('products', products);
    await queryInterface.bulkInsert('product_variants', productVariants);
    await queryInterface.bulkInsert('product_images', productImages);
    const liveProducts = products.filter(p => p.status === 'LIVE');
    console.log(`✓ Created ${products.length} products (${liveProducts.length} live) with ${productVariants.length} variants and ${productImages.length} images`);

    // ─── COUPONS (25) ────────────────────────────────────────
    console.log('Creating coupons...');
    const coupons = [];
    const couponCodes = ['WELCOME10', 'SAVE20', 'SUMMER25', 'FLASH50', 'FIRST100', 'LOYALTY15', 'MEGA30', 'CLEAR40', 'VIP25', 'SPECIAL35', 'NEWUSER20', 'RETURN10', 'BULK15', 'HOLIDAY50', 'WEEKEND20', 'FLASH30', 'SUPER25', 'DEAL40', 'PROMO15', 'EXTRA10', 'LAUNCH50', 'REPUBLIC25', 'DIWALI50', 'NOVEMBER30', 'YEAREND40'];
    const couponTypes = ['PERCENTAGE', 'FLAT', 'FREE_SHIPPING'];
    for (let i = 0; i < 25; i++) {
      const type = couponTypes[i % 3];
      const startDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      const endDate = new Date(Date.now() + (i < 20 ? 45 : -5) * 24 * 60 * 60 * 1000);
      const status = i < 20 ? 'ACTIVE' : (i < 23 ? 'EXPIRED' : 'DRAFT');
      coupons.push({
        id: uuidv4(), code: couponCodes[i], type,
        value: type === 'PERCENTAGE' ? randomInt(10, 50) : type === 'FLAT' ? randomInt(50, 300) : null,
        maxDiscountCap: type === 'PERCENTAGE' ? randomInt(100, 500) : null,
        minOrderValue: randomInt(50, 500), minQuantity: null,
        applicableScope: JSON.stringify({ type: 'all', ids: [] }),
        excludedItems: JSON.stringify({ productIds: [], categoryIds: [] }),
        userRestriction: JSON.stringify({ type: 'all' }),
        usageLimitTotal: randomInt(100, 2000), usageLimitPerUser: randomInt(1, 5),
        usedCount: randomInt(0, 80), startDate, endDate, stackable: i % 4 === 0, priority: randomInt(0, 10),
        status, createdById: adminIds[0], vendorId: null, createdAt: now, updatedAt: now,
      });
    }
    await queryInterface.bulkInsert('coupons', coupons);
    console.log(`✓ Created ${coupons.length} coupons`);

    // ─── ORDERS (200) ────────────────────────────────────────
    console.log('Creating orders...');
    const orders = [];
    const subOrders = [];
    const orderItems = [];
    const couponUsages = [];
    const shipments = [];
    const commissionLedgers = [];
    const returnRequests = [];
    const statusFlow = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];
    const carriers = ['BlueDart', 'Delhivery', 'DTDC', 'Ecom Express', 'XpressBees'];
    // Build product-to-variant lookup
    const productVariantMap = {};
    for (const v of productVariants) {
      if (!productVariantMap[v.productId]) productVariantMap[v.productId] = [];
      productVariantMap[v.productId].push(v);
    }

    for (let i = 0; i < 200; i++) {
      const orderId = uuidv4();
      const customer = randomElement(customers);
      const customerAddresses = addresses.filter(a => a.userId === customer.id);
      const address = randomElement(customerAddresses);
      const orderDate = new Date(Date.now() - randomInt(1, 120) * 24 * 60 * 60 * 1000);
      const orderStatus = randomElement([...statusFlow, 'CANCELLED']);
      const useCoupon = Math.random() > 0.65 && orderStatus !== 'CANCELLED';
      const coupon = useCoupon ? randomElement(coupons.filter(c => c.status === 'ACTIVE')) : null;

      const orderVendors = [];
      const numVendors = randomInt(1, 3);
      for (let v = 0; v < numVendors; v++) {
        const vendor = randomElement(approvedVendors);
        if (!orderVendors.find(ov => ov.id === vendor.id)) orderVendors.push(vendor);
      }

      let orderTotal = 0;
      let orderDiscount = 0;

      for (const vendor of orderVendors) {
        const subOrderId = uuidv4();
        const vendorLiveProducts = liveProducts.filter(p => p.vendorId === vendor.id);
        if (!vendorLiveProducts.length) continue;
        const numItems = randomInt(1, 4);
        let subOrderTotal = 0;
        let isShipped = ['SHIPPED', 'DELIVERED'].includes(orderStatus);

        for (let j = 0; j < numItems; j++) {
          const product = randomElement(vendorLiveProducts);
          const variants = productVariantMap[product.id];
          if (!variants || !variants.length) continue;
          const variant = variants[0]; // use the default variant
          const quantity = randomInt(1, 4);
          const unitPrice = parseFloat(variant.price);
          const itemTotal = Math.round(unitPrice * quantity * 100) / 100;
          subOrderTotal += itemTotal;

          const orderItemId = uuidv4();
          orderItems.push({
            id: orderItemId, subOrderId, variantId: variant.id,
            productName: product.name, quantity, unitPrice,
            createdAt: orderDate, updatedAt: orderDate,
          });

          // Return requests for ~10% of DELIVERED items
          if (orderStatus === 'DELIVERED' && Math.random() > 0.9) {
            const returnReasons = ['DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'NO_LONGER_NEEDED'];
            returnRequests.push({
              id: uuidv4(), subOrderId, orderItemId, userId: customer.id,
              reason: `Item did not meet expectations`, reasonCode: randomElement(returnReasons),
              status: randomElement(['REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED']),
              refundAmount: itemTotal, resolvedById: null, resolvedAt: null,
              createdAt: new Date(orderDate.getTime() + randomInt(5, 15) * 24 * 60 * 60 * 1000),
              updatedAt: new Date(orderDate.getTime() + randomInt(5, 15) * 24 * 60 * 60 * 1000),
            });
          }
        }

        orderTotal += subOrderTotal;

        subOrders.push({
          id: subOrderId, orderId, vendorId: vendor.id, status: orderStatus,
          subtotal: subOrderTotal,
          commissionAmount: Math.round(subOrderTotal * (vendor.commissionRate / 100) * 100) / 100,
          trackingId: isShipped ? `TRK${String(i * 10 + orderVendors.indexOf(vendor)).padStart(10, '0')}` : null,
          createdAt: orderDate, updatedAt: orderDate,
        });

        // Shipments
        if (isShipped) {
          const shippedDate = new Date(orderDate.getTime() + 2 * 24 * 60 * 60 * 1000);
          shipments.push({
            id: uuidv4(), subOrderId, carrier: randomElement(carriers),
            trackingNumber: `TRK${String(i * 10 + orderVendors.indexOf(vendor)).padStart(12, '0')}`,
            trackingUrl: `https://track.${randomElement(carriers).toLowerCase()}.com/TRK${String(i).padStart(12, '0')}`,
            status: orderStatus === 'DELIVERED' ? 'DELIVERED' : 'IN_TRANSIT',
            estimatedDeliveryDate: new Date(orderDate.getTime() + randomInt(5, 10) * 24 * 60 * 60 * 1000),
            shippedAt: shippedDate,
            deliveredAt: orderStatus === 'DELIVERED' ? new Date(orderDate.getTime() + randomInt(5, 8) * 24 * 60 * 60 * 1000) : null,
            createdAt: shippedDate, updatedAt: shippedDate,
          });
        }

        // Commission ledger
        if (orderStatus === 'DELIVERED') {
          commissionLedgers.push({
            id: uuidv4(), vendorId: vendor.id, subOrderId,
            saleAmount: subOrderTotal, commissionRate: vendor.commissionRate,
            commissionAmount: Math.round(subOrderTotal * (vendor.commissionRate / 100) * 100) / 100,
            status: randomElement(['PENDING', 'SETTLED', 'SETTLED']),
            createdAt: new Date(orderDate.getTime() + 8 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(orderDate.getTime() + 8 * 24 * 60 * 60 * 1000),
          });
        }
      }

      // Coupon
      if (coupon && orderTotal > 0) {
        if (coupon.type === 'PERCENTAGE') {
          orderDiscount = Math.min(Math.round((orderTotal * coupon.value) / 100 * 100) / 100, coupon.maxDiscountCap || Infinity);
        } else if (coupon.type === 'FLAT') {
          orderDiscount = Math.min(coupon.value, orderTotal);
        }
        couponUsages.push({
          id: uuidv4(), couponId: coupon.id, orderId, userId: customer.id,
          discountApplied: orderDiscount, usedAt: orderDate, createdAt: orderDate, updatedAt: orderDate,
        });
      }

      const grandTotal = Math.max(0, orderTotal - orderDiscount);
      const paymentStatus = orderStatus === 'CANCELLED' ? 'FAILED' : (orderStatus === 'PENDING' ? 'PENDING' : 'PAID');

      orders.push({
        id: orderId, userId: customer.id, couponId: coupon ? coupon.id : null,
        totalAmount: orderTotal, discountTotal: orderDiscount,
        status: orderStatus, paymentStatus,
        shippingAddressId: address.id,
        razorpayOrderId: paymentStatus !== 'FAILED' ? `order_${uuidv4().replace(/-/g, '').slice(0, 14)}` : null,
        razorpayPaymentId: paymentStatus === 'PAID' ? `pay_${uuidv4().replace(/-/g, '').slice(0, 14)}` : null,
        createdAt: orderDate, updatedAt: orderDate,
      });

      if ((i + 1) % 50 === 0) console.log(`  Created ${i + 1}/200 orders...`);
    }
    await queryInterface.bulkInsert('orders', orders);
    await queryInterface.bulkInsert('sub_orders', subOrders);
    if (orderItems.length) await queryInterface.bulkInsert('order_items', orderItems);
    if (couponUsages.length) await queryInterface.bulkInsert('coupon_usages', couponUsages);
    if (shipments.length) await queryInterface.bulkInsert('shipments', shipments);
    if (commissionLedgers.length) await queryInterface.bulkInsert('commission_ledgers', commissionLedgers);
    if (returnRequests.length) await queryInterface.bulkInsert('return_requests', returnRequests);
    console.log(`✓ Created ${orders.length} orders with sub-orders, items, shipments, commissions, and returns`);

    // ─── PAYOUTS (40) ────────────────────────────────────────
    console.log('Creating payouts...');
    const payouts = [];
    for (const vendor of approvedVendors.slice(0, 18)) {
      const numPayouts = randomInt(1, 3);
      for (let p = 0; p < numPayouts; p++) {
        const daysAgo = randomInt(10, 120);
        const startDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        payouts.push({
          id: uuidv4(), vendorId: vendor.id, amount: randomInt(500, 8000),
          periodStart: new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000),
          periodEnd: startDate,
          status: randomElement(['PENDING', 'PROCESSING', 'PAID', 'PAID']),
          paymentReferenceNumber: daysAgo > 30 ? `pout_${uuidv4().replace(/-/g, '').slice(0, 14)}` : null,
          paidAt: daysAgo > 30 ? new Date(startDate.getTime() + 3 * 24 * 60 * 60 * 1000) : null,
          createdAt: startDate, updatedAt: startDate,
        });
      }
    }
    await queryInterface.bulkInsert('payouts', payouts);
    console.log(`✓ Created ${payouts.length} payouts`);

    // ─── REVIEWS (300) ───────────────────────────────────────
    console.log('Creating reviews...');
    const reviews = [];
    const reviewVotes = [];
    const deliveredOrders = orders.filter(o => o.status === 'DELIVERED');
    const deliveredOrderItems = orderItems.filter(oi => {
      const so = subOrders.find(s => s.id === oi.subOrderId);
      const o = so ? orders.find(ord => ord.id === so.orderId) : null;
      return o && o.status === 'DELIVERED';
    });
    const usedOrderItemIds = new Set();
    for (let i = 0; i < Math.min(300, deliveredOrderItems.length); i++) {
      const oi = randomElement(deliveredOrderItems);
      if (usedOrderItemIds.has(oi.id)) continue; // unique constraint on orderItemId
      usedOrderItemIds.add(oi.id);
      const so = subOrders.find(s => s.id === oi.subOrderId);
      const order = orders.find(o => o.id === so.orderId);
      if (!order) continue;
      const product = products.find(p => p.id === (productVariants.find(v => v.id === oi.variantId) || {}).productId);
      if (!product) continue;
      const reviewId = uuidv4();
      const rating = randomInt(3, 5);
      const reviewDate = new Date(order.createdAt.getTime() + randomInt(5, 30) * 24 * 60 * 60 * 1000);
      const ratingTexts = { 5: ['Excellent product!', 'Absolutely love it!', 'Best purchase ever!'], 4: ['Great quality!', 'Very good product.', 'Happy with this purchase.'], 3: ['Decent for the price.', 'Okay product.', 'Does the job.'] };
      const bodies = { 5: 'Exceeded my expectations. Highly recommended to anyone looking for quality.', 4: 'Good quality and fast delivery. Would buy again from this seller.', 3: 'Average product. Works as advertised but nothing extraordinary.' };
      reviews.push({
        id: reviewId, productId: product.id, userId: order.userId, orderItemId: oi.id,
        rating, title: randomElement(ratingTexts[rating] || ratingTexts[4]), body: bodies[rating] || bodies[4],
        status: 'APPROVED', helpfulCount: randomInt(0, 25), unhelpfulCount: randomInt(0, 5),
        createdAt: reviewDate, updatedAt: reviewDate,
      });
      // Votes
      if (Math.random() > 0.4) {
        const usedVoters = new Set();
        for (let v = 0; v < Math.min(randomInt(1, 8), customers.length); v++) {
          const voter = randomElement(customers.filter(c => c.id !== order.userId && !usedVoters.has(c.id)));
          if (!voter || usedVoters.has(voter.id)) continue;
          usedVoters.add(voter.id);
          reviewVotes.push({
            id: uuidv4(), reviewId, userId: voter.id,
            vote: Math.random() > 0.15 ? 'HELPFUL' : 'UNHELPFUL',
            createdAt: new Date(reviewDate.getTime() + randomInt(1, 20) * 24 * 60 * 60 * 1000),
            updatedAt: new Date(reviewDate.getTime() + randomInt(1, 20) * 24 * 60 * 60 * 1000),
          });
        }
      }
    }
    await queryInterface.bulkInsert('reviews', reviews);
    if (reviewVotes.length) await queryInterface.bulkInsert('review_votes', reviewVotes);
    console.log(`✓ Created ${reviews.length} reviews with ${reviewVotes.length} votes`);

    // ─── CARTS (80) ──────────────────────────────────────────
    console.log('Creating carts...');
    const carts = [];
    const cartItems = [];
    for (const customer of customers.slice(0, 80)) {
      const cartId = uuidv4();
      carts.push({ id: cartId, userId: customer.id, createdAt: now, updatedAt: now });
      for (let j = 0; j < randomInt(1, 8); j++) {
        const product = randomElement(liveProducts);
        const variants = productVariantMap[product.id];
        if (!variants) continue;
        cartItems.push({
          id: uuidv4(), cartId, variantId: randomElement(variants).id,
          quantity: randomInt(1, 3), createdAt: now, updatedAt: now,
        });
      }
    }
    await queryInterface.bulkInsert('carts', carts);
    await queryInterface.bulkInsert('cart_items', cartItems);
    console.log(`✓ Created ${carts.length} carts with ${cartItems.length} items`);

    // ─── WISHLISTS (60) ──────────────────────────────────────
    console.log('Creating wishlists...');
    const wishlists = [];
    const wishlistItems = [];
    for (const customer of customers.slice(0, 60)) {
      const wishlistId = uuidv4();
      wishlists.push({ id: wishlistId, userId: customer.id, createdAt: now, updatedAt: now });
      const usedProductIds = new Set();
      for (let j = 0; j < randomInt(3, 12); j++) {
        const product = randomElement(liveProducts);
        if (usedProductIds.has(product.id)) continue; // unique constraint on (wishlistId, productId)
        usedProductIds.add(product.id);
        wishlistItems.push({
          id: uuidv4(), wishlistId, productId: product.id,
          priceAtAdd: parseFloat(product.basePrice),
          createdAt: now, updatedAt: now,
        });
      }
    }
    await queryInterface.bulkInsert('wishlists', wishlists);
    await queryInterface.bulkInsert('wishlist_items', wishlistItems);
    console.log(`✓ Created ${wishlists.length} wishlists with ${wishlistItems.length} items`);

    // ─── TAX RULES ──────────────────────────────────────────
    console.log('Creating tax rules...');
    const taxRules = [];
    const taxCategories = categories.filter(c => c.parentId !== null).slice(0, 20);
    const gstRates = [5, 12, 18, 28];
    for (const cat of taxCategories) {
      taxRules.push({
        id: uuidv4(), categoryId: cat.id, hsnCode: `HSN${String(randomInt(1000, 9999)).padStart(8, '0')}`,
        gstPercentage: randomElement(gstRates),
        createdAt: now, updatedAt: now,
      });
    }
    // Add a few platform-wide default rules (no specific category)
    for (const rate of gstRates) {
      taxRules.push({
        id: uuidv4(), categoryId: null, hsnCode: `DEFAULT-${rate}`,
        gstPercentage: rate,
        createdAt: now, updatedAt: now,
      });
    }
    await queryInterface.bulkInsert('tax_rules', taxRules);
    console.log(`✓ Created ${taxRules.length} tax rules`);

    // ─── SUMMARY ─────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════');
    console.log('✅ SEEDING COMPLETED SUCCESSFULLY!');
    console.log('═══════════════════════════════════════\n');
    console.log('Summary:');
    console.log(`  ${categories.length} categories (${Object.keys(categoryNames).length} parent, ${allLeaves.length} leaf)`);
    console.log(`  ${vendors.length} vendors (${approvedVendors.length} approved, ${vendors.length - approvedVendors.length} pending)`);
    console.log(`  ${vendorOwners.length + vendorStaff.length} vendor users (owners + staff)`);
    console.log(`  ${adminUsers.length} admin users`);
    console.log(`  ${customers.length} customers`);
    console.log(`  ${addresses.length} addresses`);
    console.log(`  ${products.length} products (${liveProducts.length} live)`);
    console.log(`  ${productVariants.length} product variants`);
    console.log(`  ${productImages.length} product images`);
    console.log(`  ${coupons.length} coupons (${coupons.filter(c => c.status === 'ACTIVE').length} active)`);
    console.log(`  ${orders.length} orders (${orders.filter(o => o.status === 'DELIVERED').length} delivered)`);
    console.log(`  ${subOrders.length} sub-orders`);
    console.log(`  ${orderItems.length} order items`);
    console.log(`  ${shipments.length} shipments`);
    console.log(`  ${commissionLedgers.length} commission entries`);
    console.log(`  ${returnRequests.length} return requests`);
    console.log(`  ${payouts.length} payouts`);
    console.log(`  ${reviews.length} reviews`);
    console.log(`  ${reviewVotes.length} review votes`);
    console.log(`  ${carts.length} active carts`);
    console.log(`  ${cartItems.length} cart items`);
    console.log(`  ${wishlists.length} wishlists`);
    console.log(`  ${wishlistItems.length} wishlist items`);
    console.log(`  ${taxRules.length} tax rules`);
    console.log(`  ${shippingZones.length} shipping zones`);
    console.log(`  ${shippingRates.length} shipping rates\n`);
    console.log('Test credentials (Super Admin uses Admin@123; everyone else Test@123):');
    console.log('  SUPER_ADMIN:        admin@ecommerce.com');
    console.log('  ORDER_MANAGER:      ordermanager@ecommerce.com');
    console.log('  CATALOG_MANAGER:    catalogmanager@ecommerce.com');
    console.log('  VENDOR_OWNER:       owner@techworld.com');
    console.log('  VENDOR_STAFF:       staff@techworld.com');
    console.log('  CUSTOMER:           amit.gupta54@example.com\n');
  },

  async down(queryInterface) {
    console.log('Removing all seeded data...');
    const tables = [
      'wishlist_items', 'wishlists', 'cart_items', 'carts',
      'review_votes', 'reviews', 'return_requests', 'shipments', 'commission_ledgers',
      'payouts', 'coupon_usages', 'order_items', 'sub_orders', 'orders',
      'coupons', 'product_images', 'product_variants', 'products',
      'shipping_rates', 'shipping_zones', 'tax_rules',
      'addresses', 'vendor_documents', 'users', 'vendors', 'categories',
    ];
    for (const table of tables) {
      await queryInterface.bulkDelete(table, null, {});
    }
    console.log('✓ All seeded data removed');
  },
};
