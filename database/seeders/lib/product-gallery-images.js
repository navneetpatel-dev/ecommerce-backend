'use strict';

const { productSeedFromId } = require('./professional-catalog');

/** Minimum gallery images every seeded product should expose on the PDP. */
const MIN_PRODUCT_GALLERY_IMAGES = 12;

const GALLERY_FAMILY_KEYWORDS = {
  electronics: ['electronic', 'phone', 'laptop', 'computer', 'audio', 'gadget', 'tech', 'camera', 'tablet', 'headphone'],
  fashion: ['fashion', 'apparel', 'clothing', 'wear', 'shirt', 'dress', 'shoe', 'tshirt', 'top', 'jeans'],
  home: ['home', 'kitchen', 'cookware', 'furniture', 'decor', 'living', 'bed', 'storage', 'dining'],
  sports: ['sport', 'fitness', 'outdoor', 'camp', 'gym', 'athletic', 'yoga', 'running'],
  beauty: ['beauty', 'skin', 'cosmetic', 'hair', 'makeup', 'fragrance', 'grooming'],
  books: ['book', 'novel', 'read', 'literature', 'stationery'],
  toys: ['toy', 'game', 'kids', 'child', 'puzzle', 'play'],
  food: ['food', 'organic', 'grocery', 'snack', 'beverage', 'fruit', 'vegetable', 'gourmet'],
  automotive: ['auto', 'car', 'vehicle', 'motor', 'garage', ' tyre', 'tire'],
  jewelry: ['jewel', 'ring', 'necklace', 'watch', 'gold', 'silver', 'bracelet'],
};

const PRODUCT_GALLERY_IMAGES = {
  electronics: [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1484788984921-03950022c9ef?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1587825140708-dfaf72ae4b04?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1625842268584-8f3296236761?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1611186871348-b1ce696e52be?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1606144042614-b2417e99c4e9?w=1200&fit=crop',
  ],
  fashion: [
    'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1483985988355-763728e3685b?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1525507119025-ed4c629a60a3?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1556906782-0868-5d5ba856a5?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=1200&fit=crop',
  ],
  home: [
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1538688525198-9b88f6f53126?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1505691938895-1758d7feb511?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1618221195710-dd6b41fa0246?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1615529328331-f8917597711f?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1615874959473-d37bffaf2b75?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1616047006789-b7df533aa5be?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1616594039964-ae9021a400a0?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1616137467421-06b5a462bf69?w=1200&fit=crop',
  ],
  sports: [
    'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1530549387789-4c1017266635?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1627483298428-03a2c310a14f?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1200&fit=crop&sat=-100',
    'https://images.unsplash.com/photo-1571019613454-1cb2f99b247d?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=1200&h=1200&fit=crop',
  ],
  beauty: [
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1570194065650-d99fb4d8a609?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1526947425960-945c6e72858f?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=1200&fit=crop&auto=format',
    'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=1200&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1570172629644-d6990b57a50b?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=1200&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1570554886111-e80fcca6a029?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1522338242992-e1a54906a8da?w=1200&fit=crop',
  ],
  books: [
    'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1526243741027-444d633d7365?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1519682337058-a94d519337bc?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=1200&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1497633763785-7899ea7989b8?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1524995998268-4c1bbf899d87?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1516979187450-56461b480399?w=1200&fit=crop',
  ],
  toys: [
    'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1576670159805-381ae21d34c2?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1559511260-66a3e7f2f8a2?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=1200&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=1200&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=1200&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=1200&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=1200&h=1200&fit=crop',
  ],
  food: [
    'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1482049010765-37166db42ed6?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1506089676907-37e9b0ad3836?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1495521823157-407108763589?w=1200&fit=crop',
  ],
  automotive: [
    'https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1494905998402-395d579af36f?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1493238792000-8113da705763?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1617531653332-bd46c24f2068?w=1200&fit=crop',
  ],
  jewelry: [
    'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1599643478518-a3c4e2e36301?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1601121141461-9d6647bca1ed?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1573408301185-9146fe634ad0?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1603561596117-043a5f0d5a05?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1506630448388-4e683c67ddb0?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=1200&h=1200&fit=crop',
    'https://images.unsplash.com/photo-1611652022418-6c0c4d0a3141?w=1200&fit=crop',
    'https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?w=1200&fit=crop',
  ],
};

const DEFAULT_GALLERY_KEY = 'electronics';

function resolveGalleryKey(categorySlug = '', categoryName = '') {
  const haystack = `${categorySlug} ${categoryName}`.toLowerCase();
  for (const [key, keywords] of Object.entries(GALLERY_FAMILY_KEYWORDS)) {
    if (keywords.some((word) => haystack.includes(word))) return key;
  }
  return DEFAULT_GALLERY_KEY;
}

function galleryPoolForKey(key) {
  return PRODUCT_GALLERY_IMAGES[key] || PRODUCT_GALLERY_IMAGES[DEFAULT_GALLERY_KEY];
}

/** Deterministic gallery URLs for a product — rotated by product id for variety. */
function buildGalleryUrls(galleryKey, productId, count = MIN_PRODUCT_GALLERY_IMAGES) {
  const pool = galleryPoolForKey(galleryKey);
  const start = productSeedFromId(productId) % pool.length;
  const urls = [];
  for (let i = 0; i < count; i += 1) {
    urls.push(pool[(start + i) % pool.length]);
  }
  return urls;
}

module.exports = {
  MIN_PRODUCT_GALLERY_IMAGES,
  PRODUCT_GALLERY_IMAGES,
  resolveGalleryKey,
  buildGalleryUrls,
};
