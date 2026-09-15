import { Router } from 'express';
import { API_MOUNTS } from '@core/constants/apiPaths';
import { NotFoundError } from '@core/errors/NotFoundError';
import { authRoutes } from '@modules/auth/auth.routes';
import usersRoutes from '@modules/users/users.routes';
import vendorsRoutes from '@modules/vendors/vendors.routes';
import adminRoutes from '@modules/admin/admin.routes';
import categoriesRoutes from '@modules/categories/categories.routes';
import productsRoutes from '@modules/products/products.routes';
import cartRoutes from '@modules/cart/cart.routes';
import checkoutRoutes from '@modules/checkout/checkout.routes';
import ordersRoutes from '@modules/orders/orders.routes';
import subordersRoutes from '@modules/suborders/suborders.routes';
import couponsRoutes from '@modules/coupons/coupons.routes';
import commissionsRoutes from '@modules/commissions/commissions.routes';
import payoutsRoutes from '@modules/payouts/payouts.routes';
import shippingRoutes from '@modules/shipping/shipping.routes';
import returnsRoutes from '@modules/returns/returns.routes';
import taxRoutes from '@modules/tax/tax.routes';
import reviewsRoutes from '@modules/reviews/reviews.routes';
import wishlistRoutes from '@modules/wishlist/wishlist.routes';
import searchRoutes from '@modules/search/search.routes';
import notificationsRoutes from '@modules/notifications/notifications.routes';
import inventoryRoutes from '@modules/inventory/inventory.routes';
import webhooksRoutes from '@modules/webhooks/webhooks.routes';
import newsletterRoutes from '@modules/newsletter/newsletter.routes';
import auditRoutes from '@modules/audit/audit.routes';
import settingsRoutes from '@modules/settings/settings.routes';
import homepageRoutes from '@modules/homepage/homepage.routes';
import reportsRoutes from '@modules/reports/reports.routes';
import walletRoutes from '@modules/wallet/wallet.routes';
import walletAdminRoutes from '@modules/wallet/wallet.admin.routes';
import uploadsRoutes from '@modules/uploads/uploads.routes';
import supportTicketsRoutes from '@modules/supportTickets/supportTickets.routes';
import bugReportsRoutes from '@modules/bugReports/bugReports.routes';
import deliveryAgentsRoutes from '@modules/deliveryAgents/deliveryAgents.routes';
import webVitalsRoutes from '@modules/webVitals/webVitals.routes';
import productQnaRoutes from '@modules/productQna/productQna.routes';
import giftCardsRoutes from '@modules/giftCards/giftCards.routes';
import paymentsRoutes from '@modules/payments/payments.routes';
import rolesRoutes from '@modules/roles/roles.routes';
import exportsRoutes from '@modules/exports/exports.routes';

const router = Router();

router.use(API_MOUNTS.auth, authRoutes);
router.use(API_MOUNTS.users, usersRoutes);
router.use(API_MOUNTS.vendors, vendorsRoutes);
router.use(API_MOUNTS.admin, adminRoutes);
router.use(API_MOUNTS.categories, categoriesRoutes);
router.use(API_MOUNTS.products, productsRoutes);
router.use(API_MOUNTS.cart, cartRoutes);
router.use(API_MOUNTS.checkout, checkoutRoutes);
router.use(API_MOUNTS.orders, ordersRoutes);
router.use(API_MOUNTS.suborders, subordersRoutes);
router.use(API_MOUNTS.webhooks, webhooksRoutes);
router.use(API_MOUNTS.coupons, couponsRoutes);
router.use(API_MOUNTS.commissions, commissionsRoutes);
router.use(API_MOUNTS.payouts, payoutsRoutes);
router.use(API_MOUNTS.shipping, shippingRoutes);
router.use(API_MOUNTS.returns, returnsRoutes);
router.use(API_MOUNTS.tax, taxRoutes);
router.use(API_MOUNTS.reviews, reviewsRoutes);
router.use(API_MOUNTS.wishlist, wishlistRoutes);
router.use(API_MOUNTS.search, searchRoutes);
router.use(API_MOUNTS.notifications, notificationsRoutes);
router.use(API_MOUNTS.inventory, inventoryRoutes);
router.use(API_MOUNTS.newsletter, newsletterRoutes);
router.use(API_MOUNTS.audit, auditRoutes);
router.use(API_MOUNTS.settings, settingsRoutes);
router.use(API_MOUNTS.homepage, homepageRoutes);
router.use(API_MOUNTS.reports, reportsRoutes);
router.use(API_MOUNTS.wallet, walletRoutes);
router.use(API_MOUNTS.adminWallet, walletAdminRoutes);
router.use(API_MOUNTS.uploads, uploadsRoutes);
router.use(API_MOUNTS.supportTickets, supportTicketsRoutes);
router.use(API_MOUNTS.bugReports, bugReportsRoutes);
router.use(API_MOUNTS.deliveryAgents, deliveryAgentsRoutes);
router.use(API_MOUNTS.webVitals, webVitalsRoutes);
router.use(API_MOUNTS.productQna, productQnaRoutes);
router.use(API_MOUNTS.giftCards, giftCardsRoutes);
router.use(API_MOUNTS.payments, paymentsRoutes);
router.use(API_MOUNTS.roles, rolesRoutes);
router.use(API_MOUNTS.exports, exportsRoutes);

// Catch-all for any /api/v1/... path that matched none of the mounts above — without this,
// Express falls through to its default HTML 404 ("Cannot GET /api/v1/xyz") instead of the API's
// standard JSON error envelope, which is inconsistent for frontend error handling and external
// integrators (e.g. debugging a webhook misconfiguration).
router.use((_req, _res, next) => {
  next(new NotFoundError('Route'));
});

export { router as routes };
