'use strict';

/** Deterministic pseudo-random in [0, 1). */
function seededUnit(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function seededInt(seed, min, max) {
  return Math.floor(seededUnit(seed) * (max - min + 1)) + min;
}

function slugToken(value) {
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 6);
}

/** Stable numeric seed from product UUID — same product always gets the same variants. */
function productSeedFromId(productId) {
  const compact = String(productId).replace(/-/g, '');
  return parseInt(compact.slice(0, 8), 16) % 2147483647;
}

/** Globally unique SKU prefix tied to product id (not query row index). */
function skuPrefixFromProductId(productId) {
  return String(productId).replace(/-/g, '').slice(0, 10).toUpperCase();
}

const CATEGORY_FAMILIES = {
  fashion: {
    brands: ['Urban Loom', 'Thread & Co', 'NovaWear', 'ClassicFit', 'SilkRoute'],
    attrs: [
      { key: 'Size', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
      { key: 'Color', values: ['Black', 'Navy', 'White', 'Olive', 'Maroon', 'Beige'] },
    ],
    specs: (name, categoryName) => ({
      'Fabric': 'Premium cotton blend',
      'Fit': 'Regular fit',
      'Care': 'Machine wash cold, line dry',
      'Country of origin': 'India',
      'Ideal for': categoryName,
      'Pack contains': '1 unit',
    }),
    highlights: (brand) => [
      `${brand} quality assurance`,
      'Breathable fabric for all-day comfort',
      'Colour-fast & shrink-resistant finish',
      'Easy care — machine washable',
      'Free exchange on size mismatch',
    ],
  },
  electronics: {
    brands: ['TechNova', 'PulseGear', 'ZenByte', 'CircuitOne', 'VoltEdge'],
    attrs: [
      { key: 'Storage', values: ['64 GB', '128 GB', '256 GB'] },
      { key: 'Color', values: ['Graphite', 'Silver', 'Midnight Blue'] },
    ],
    specs: (name, categoryName) => ({
      'Model': name.split(' ').slice(-2).join(' '),
      'Warranty': '1 year manufacturer warranty',
      'In the box': 'Device, USB cable, quick-start guide',
      'Connectivity': 'Wi‑Fi / Bluetooth',
      'Category': categoryName,
      'Certification': 'BIS compliant',
    }),
    highlights: (brand) => [
      `${brand} genuine product with warranty card`,
      'Fast charging & energy-efficient design',
      'Optimized for everyday performance',
      'Secure packaging with tamper seal',
      'Pan-India service support',
    ],
  },
  home: {
    brands: ['HomeCraft', 'LivingEssentials', 'Nest & Bloom', 'ArtisanHome', 'PureNest'],
    attrs: [
      { key: 'Size', values: ['Small', 'Medium', 'Large'] },
      { key: 'Material', values: ['Steel', 'Wood', 'Ceramic', 'Glass'] },
    ],
    specs: (name, categoryName) => ({
      'Material': 'Food-grade / home-safe materials',
      'Finish': 'Scratch-resistant',
      'Care': 'Wipe clean with damp cloth',
      'Category': categoryName,
      'Assembly': 'Ready to use',
      'Warranty': '6 months against manufacturing defects',
    }),
    highlights: (brand) => [
      `${brand} curated for modern homes`,
      'Durable build for daily use',
      'Easy to clean & maintain',
      'Compact packaging — minimal waste',
      'Ideal for gifting',
    ],
  },
  sports: {
    brands: ['ActivePulse', 'StrideMax', 'PeakForm', 'FlexRun', 'SportHive'],
    attrs: [
      { key: 'Size', values: ['S', 'M', 'L', 'XL'] },
      { key: 'Color', values: ['Black', 'Red', 'Blue', 'Grey'] },
    ],
    specs: (name, categoryName) => ({
      'Activity': categoryName,
      'Material': 'Moisture-wicking performance fabric',
      'Fit': 'Athletic fit',
      'Care': 'Hand wash recommended',
      'Ideal for': 'Training & outdoor use',
    }),
    highlights: (brand) => [
      `${brand} performance series`,
      'Lightweight & sweat-resistant',
      'Reinforced stitching at stress points',
      'Designed for mobility and comfort',
    ],
  },
  beauty: {
    brands: ['GlowKind', 'PureDerm', 'VelvetSkin', 'AuraCare', 'Botanica'],
    attrs: [
      { key: 'Volume', values: ['30 ml', '50 ml', '100 ml'] },
      { key: 'Shade', values: ['Natural', 'Rose', 'Ivory', 'Cocoa'] },
    ],
    specs: (name, categoryName) => ({
      'Skin type': 'All skin types',
      'Formulation': 'Dermatologically tested',
      'Free from': 'Parabens & sulphates',
      'Category': categoryName,
      'Shelf life': '24 months from manufacture',
    }),
    highlights: (brand) => [
      `${brand} clean-beauty standards`,
      'Suitable for daily use',
      'Travel-friendly packaging',
      'Cruelty-free formulation',
    ],
  },
  default: {
    brands: ['Marketplace Select', 'Everyday Essentials', 'PrimePick', 'ValuePlus'],
    attrs: [
      { key: 'Size', values: ['Standard', 'Large'] },
      { key: 'Color', values: ['Black', 'White', 'Blue'] },
    ],
    specs: (name, categoryName) => ({
      'Category': categoryName,
      'Quality': 'Quality checked before dispatch',
      'Origin': 'India',
      'Return policy': 'Eligible for easy returns',
    }),
    highlights: (brand) => [
      `${brand} trusted quality`,
      'Secure packaging',
      'Fast dispatch from verified seller',
    ],
  },
};

const FAMILY_KEYWORDS = {
  fashion: ['fashion', 'apparel', 'clothing', 'wear', 'shirt', 'dress', 'shoe', 'tshirt', 'top'],
  electronics: ['electronic', 'phone', 'laptop', 'computer', 'audio', 'gadget', 'tech', 'camera'],
  home: ['home', 'kitchen', 'cookware', 'furniture', 'decor', 'living', 'bed', 'storage'],
  sports: ['sport', 'fitness', 'outdoor', 'camp', 'gym', 'athletic'],
  beauty: ['beauty', 'skin', 'cosmetic', 'hair', 'makeup', 'fragrance'],
};

function resolveFamily(categorySlug = '', categoryName = '') {
  const haystack = `${categorySlug} ${categoryName}`.toLowerCase();
  for (const [family, keywords] of Object.entries(FAMILY_KEYWORDS)) {
    if (keywords.some((word) => haystack.includes(word))) return family;
  }
  return 'default';
}

function cartesian(attrs) {
  if (!attrs.length) return [{}];
  const [first, ...rest] = attrs;
  const tail = cartesian(rest);
  const combos = [];
  for (const value of first.values) {
    for (const child of tail) {
      combos.push({ [first.key]: value, ...child });
    }
  }
  return combos;
}

function buildDescription({ name, brand, categoryName, family }) {
  const intro =
    family === 'electronics'
      ? `${name} from ${brand} delivers reliable performance for everyday use. Engineered with attention to detail, it balances functionality with a refined design that fits modern lifestyles.`
      : family === 'fashion'
        ? `${name} by ${brand} combines comfort with contemporary style. Tailored for versatile wear, this piece transitions effortlessly from casual outings to smart-casual settings.`
        : `${name} by ${brand} is thoughtfully designed for ${categoryName.toLowerCase()} needs. Built for durability and everyday convenience, it offers excellent value without compromising on quality.`;

  const body =
    'Each unit passes quality checks before dispatch. We recommend reviewing the specifications and variant options to choose the configuration that best suits your requirements.';

  const care =
    family === 'beauty'
      ? 'Store in a cool, dry place away from direct sunlight. Patch test before first use if you have sensitive skin.'
      : family === 'electronics'
        ? 'Register your product warranty using the card included in the box. Use only manufacturer-approved accessories for best results.'
        : 'Refer to the care instructions on the product label. Contact the seller for bulk or custom enquiries.';

  return [intro, body, care].join('\n\n');
}

function buildProductEnrichment(product) {
  const seed = productSeedFromId(product.id);
  const family = resolveFamily(product.category_slug, product.category_name);
  const profile = CATEGORY_FAMILIES[family] || CATEGORY_FAMILIES.default;
  const brand = profile.brands[seed % profile.brands.length];
  const basePrice = Number(product.basePrice);
  const markup = 0.12 + seededUnit(seed + 41) * 0.28;
  const compareAtPrice = Math.round(basePrice * (1 + markup));

  const tags = [
    brand,
    product.category_name,
    seededUnit(seed + 7) > 0.55 ? 'Bestseller' : 'Featured',
    seededUnit(seed + 13) > 0.7 ? 'New arrival' : 'Top rated',
  ];

  return {
    brand,
    compareAtPrice,
    description: buildDescription({
      name: product.name,
      brand,
      categoryName: product.category_name,
      family,
    }),
    specs: profile.specs(product.name, product.category_name),
    highlights: profile.highlights(brand),
    tags: [...new Set(tags)],
    family,
    profile,
  };
}

function buildVariantMatrix(product, enrichment) {
  const productSeed = productSeedFromId(product.id);
  const attrs = enrichment.profile.attrs;
  const combos = cartesian(attrs);
  const basePrice = Number(product.basePrice);
  const skuPrefix = skuPrefixFromProductId(product.id);

  // ~12% products fully out of stock; rest have partial OOS combos.
  const fullyOut = seededUnit(productSeed + 99) < 0.12;

  const variants = combos.map((attributes, comboIndex) => {
    const seed = productSeed * 1000 + comboIndex;
    const attrParts = Object.values(attributes).map(slugToken);
    const sku = `${skuPrefix}-${attrParts.join('-')}`.slice(0, 48);

    let stock = 0;
    if (!fullyOut) {
      const oosChance = 0.38;
      if (seededUnit(seed) >= oosChance) {
        stock = seededInt(seed + 3, 8, 140);
      }
    }

    const priceDelta = seededInt(seed + 5, 0, 3) * 50;
    const price = Math.round((basePrice + priceDelta) * 100) / 100;
    const weightGrams = seededInt(seed + 11, 180, 2400);

    return {
      sku,
      attributes,
      price,
      stock,
      lowStockAt: 5,
      weightGrams,
    };
  });

  // Ensure at least one in-stock variant unless fully OOS product.
  if (!fullyOut && !variants.some((v) => v.stock > 0)) {
    const pick = variants[seededInt(productSeed + 21, 0, variants.length - 1)];
    pick.stock = seededInt(productSeed + 22, 15, 80);
  }

  return variants;
}

module.exports = {
  seededUnit,
  productSeedFromId,
  skuPrefixFromProductId,
  buildProductEnrichment,
  buildVariantMatrix,
  resolveFamily,
};
