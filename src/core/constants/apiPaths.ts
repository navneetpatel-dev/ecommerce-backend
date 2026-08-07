/** Backend API mount paths — used by routes/index.ts and cookie path construction. */
export const API_PREFIX = '/api';

export const API_MOUNTS = {
  auth: '/auth',
  users: '/users',
  vendors: '/vendors',
  admin: '/admin',
  categories: '/categories',
  products: '/products',
  cart: '/cart',
  checkout: '/checkout',
  orders: '/orders',
  suborders: '/suborders',
  webhooks: '/webhooks',
  coupons: '/coupons',
  commissions: '/commissions',
  payouts: '/payouts',
  shipping: '/shipping',
  returns: '/returns',
  tax: '/tax',
  reviews: '/reviews',
  wishlist: '/wishlist',
  search: '/search',
  notifications: '/notifications',
  inventory: '/inventory',
  help: '/help',
  audit: '/audit',
  settings: '/settings',
  homepage: '/homepage',
  reports: '/reports',
} as const;

export const HEALTH_PATH = '/health';

export const AUTH_COOKIE_PATH = `${API_PREFIX}${API_MOUNTS.auth}`;
export const WEBHOOKS_RAW_PATH = `${API_PREFIX}${API_MOUNTS.webhooks}`;
