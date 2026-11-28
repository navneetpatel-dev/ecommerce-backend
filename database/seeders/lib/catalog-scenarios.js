'use strict';

/**
 * One example of everything the catalog rules can do, all under TechWorld so it can be tried with
 * owner@techworld.com, staff@techworld.com and the shopper below. Product names start with
 * "Scenario". Each entry: what to look at.
 */

const SHOPPER_EMAIL = 'amit.gupta54@example.com';
const GUEST_ALERT_EMAIL = 'guest.alert@example.com';
const VENDOR_SLUG = 'techworld';

const CATEGORIES = [
  {
    slug: 'electronics-prepaid-only',
    name: 'Prepaid Only Gadgets',
    parent: 'electronics',
    codEnabled: false,
    commissionRate: 14,
  },
  {
    slug: 'fashion-value-banded',
    name: 'Value-Banded Apparel',
    parent: 'fashion',
    codEnabled: true,
    commissionRate: null,
    // GST by value per piece: 5% up to ₹2,500, 18% above it.
    tax: { gstPercentage: 5, priceBandThreshold: 2500, gstPercentageAbove: 18, hsnCode: '6109' },
    attributes: [
      { name: 'Size', options: ['S', 'M', 'L'] },
      { name: 'Color', options: ['Black', 'White', 'Blue'] },
    ],
  },
];

/**
 * `options` are [attributes, price before GST, stock, flags]. The MRP defaults to comfortably above
 * the dearest option with GST; a scenario that needs an option above its MRP sets `mrp`.
 */
const PRODUCTS = [
  {
    slug: 'scenario-low-stock-headphones',
    name: 'Scenario Low Stock Headphones',
    category: 'electronics-audio',
    note: 'Low-stock list and widget; also carries a vendor live-edit audit entry.',
    options: [
      [{ Color: 'Black' }, 1499, 2],
      [{ Color: 'White' }, 1499, 0],
      [{ Color: 'Blue' }, 1599, 40],
    ],
  },
  {
    slug: 'scenario-sold-out-sneakers',
    name: 'Scenario Sold Out Sneakers',
    category: 'fashion-value-banded',
    note: 'Every option sold out: "Choose option" on the wishlist, notify me, pending stock alerts.',
    options: [
      [{ Size: 'S', Color: 'Black' }, 1999, 0],
      [{ Size: 'M', Color: 'Black' }, 1999, 0],
      [{ Size: 'L', Color: 'Black' }, 1999, 0],
    ],
  },
  {
    slug: 'scenario-banded-jacket',
    name: 'Scenario Banded GST Jacket',
    category: 'fashion-value-banded',
    note: 'One option below the GST price band (5%) and one above it (18%).',
    options: [
      [{ Size: 'M', Color: 'Blue' }, 1999, 25],
      [{ Size: 'L', Color: 'Blue' }, 3999, 15],
    ],
  },
  {
    slug: 'scenario-above-mrp-speaker',
    name: 'Scenario Above MRP Speaker',
    category: 'electronics-audio',
    note: 'The second option costs more than the MRP with GST, so it is not on sale (on purpose).',
    mrp: 1500,
    options: [
      [{ Color: 'Black' }, 1000, 30],
      [{ Color: 'Gold' }, 2000, 30],
    ],
  },
  {
    slug: 'scenario-rejected-lamp',
    name: 'Scenario Rejected Desk Lamp',
    category: 'home-lighting',
    status: 'REJECTED',
    rejectionNote: 'The photos do not show the lamp switched on. Please add one and resubmit.',
    note: 'The vendor sees the reason and can resubmit.',
    options: [[{ Color: 'White' }, 899, 20]],
  },
  {
    slug: 'scenario-draft-keyboard',
    name: 'Scenario Draft Keyboard',
    category: 'electronics-accessories',
    status: 'DRAFT',
    note: 'Complete draft, ready to submit.',
    options: [[{ Color: 'Grey' }, 2299, 20]],
  },
  {
    slug: 'scenario-pending-tracker',
    name: 'Scenario Pending Fitness Tracker',
    category: 'electronics-wearables',
    status: 'PENDING_APPROVAL',
    note: 'Waiting for approval.',
    options: [[{ Color: 'Black' }, 2999, 20]],
  },
  {
    slug: 'scenario-archived-charger',
    name: 'Scenario Archived Charger',
    category: 'electronics-accessories',
    status: 'ARCHIVED',
    note: 'Archived listing; can be restored.',
    options: [[{ Color: 'White' }, 499, 20]],
  },
  {
    slug: 'scenario-platform-listed-webcam',
    name: 'Scenario Platform Listed Webcam',
    category: 'electronics-accessories',
    status: 'PENDING_APPROVAL',
    listedByPlatform: true,
    note: 'Prepared and submitted by the Catalog Manager: a different admin (Super Admin) approves.',
    options: [[{ Color: 'Black' }, 1799, 20]],
  },
  {
    slug: 'scenario-two-category-earbuds',
    name: 'Scenario Two Category Earbuds',
    category: 'electronics-audio',
    secondary: 'electronics-prepaid-only',
    note: 'Also listed under Prepaid Only Gadgets (GST and commission follow Audio).',
    options: [[{ Color: 'Black' }, 1299, 35]],
  },
  {
    slug: 'scenario-prepaid-drone',
    name: 'Scenario Prepaid Only Drone',
    category: 'electronics-prepaid-only',
    note: 'No cash on delivery; the category charges its own commission.',
    options: [[{ Color: 'Grey' }, 8999, 12]],
  },
  {
    slug: 'scenario-removed-option-mouse',
    name: 'Scenario Removed Option Mouse',
    category: 'electronics-accessories',
    note: 'The shopper still has a removed option in the cart.',
    options: [
      [{ Color: 'Red' }, 699, 10, { removed: true }],
      [{ Color: 'Black' }, 699, 25],
    ],
  },
];

module.exports = { SHOPPER_EMAIL, GUEST_ALERT_EMAIL, VENDOR_SLUG, CATEGORIES, PRODUCTS };
