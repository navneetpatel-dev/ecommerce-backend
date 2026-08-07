import { sequelize } from '@config/db';
import { initRoleModel, Role } from './role.model';
import { initPermissionModel, Permission } from './permission.model';
import { initVendorModel, Vendor } from './vendor.model';
import { initUserModel, User } from './user.model';
import { initRefreshTokenModel, RefreshToken } from './refreshToken.model';
import { initAddressModel, Address } from './address.model';
import { initVendorDocumentModel, VendorDocument } from './vendorDocument.model';
import { initCategoryModel, Category } from './category.model';
import { initCategoryAttributeModel, CategoryAttribute } from './categoryAttribute.model';
import { initProductModel, Product } from './product.model';
import { initProductCategoryModel, ProductCategory } from './productCategory.model';
import { initProductVariantModel, ProductVariant } from './productVariant.model';
import { initProductImageModel, ProductImage } from './productImage.model';
import { initCartModel, Cart } from './cart.model';
import { initCartItemModel, CartItem } from './cartItem.model';
import { initOrderModel, Order } from './order.model';
import { initSubOrderModel, SubOrder } from './subOrder.model';
import { initOrderItemModel, OrderItem } from './orderItem.model';
import { initCouponModel, Coupon } from './coupon.model';
import { initCouponBatchModel, CouponBatch } from './couponBatch.model';
import { initCouponUsageModel, CouponUsage } from './couponUsage.model';
import { initWalletLedgerModel, WalletLedger } from './walletLedger.model';
import { initCommissionLedgerModel, CommissionLedger } from './commissionLedger.model';
import { initPayoutModel, Payout } from './payout.model';
import { initReviewModel, Review } from './review.model';
import { initReviewVoteModel, ReviewVote } from './reviewVote.model';
import { initWishlistModel, Wishlist } from './wishlist.model';
import { initWishlistItemModel, WishlistItem } from './wishlistItem.model';
import { initShippingZoneModel, ShippingZone } from './shippingZone.model';
import { initShippingRateModel, ShippingRate } from './shippingRate.model';
import { initShipmentModel, Shipment } from './shipment.model';
import { initReturnRequestModel, ReturnRequest } from './returnRequest.model';
import { initTaxRuleModel, TaxRule } from './taxRule.model';
import { initNotificationLogModel, NotificationLog } from './notificationLog.model';
import { initAuditLogModel, AuditLog } from './auditLog.model';
import { initWebhookEventModel, WebhookEvent } from './webhookEvent.model';
import { initHelpTicketModel, HelpTicket } from './helpTicket.model';
import { initPlatformSettingModel, PlatformSetting } from './platformSetting.model';
import { initPromoBannerModel, PromoBanner } from './promoBanner.model';

const models = {
  Role: initRoleModel(sequelize),
  Permission: initPermissionModel(sequelize),
  Vendor: initVendorModel(sequelize),
  User: initUserModel(sequelize),
  RefreshToken: initRefreshTokenModel(sequelize),
  Address: initAddressModel(sequelize),
  VendorDocument: initVendorDocumentModel(sequelize),
  Category: initCategoryModel(sequelize),
  CategoryAttribute: initCategoryAttributeModel(sequelize),
  Product: initProductModel(sequelize),
  ProductCategory: initProductCategoryModel(sequelize),
  ProductVariant: initProductVariantModel(sequelize),
  ProductImage: initProductImageModel(sequelize),
  Cart: initCartModel(sequelize),
  CartItem: initCartItemModel(sequelize),
  Order: initOrderModel(sequelize),
  SubOrder: initSubOrderModel(sequelize),
  OrderItem: initOrderItemModel(sequelize),
  Coupon: initCouponModel(sequelize),
  CouponBatch: initCouponBatchModel(sequelize),
  CouponUsage: initCouponUsageModel(sequelize),
  WalletLedger: initWalletLedgerModel(sequelize),
  CommissionLedger: initCommissionLedgerModel(sequelize),
  Payout: initPayoutModel(sequelize),
  Review: initReviewModel(sequelize),
  ReviewVote: initReviewVoteModel(sequelize),
  Wishlist: initWishlistModel(sequelize),
  WishlistItem: initWishlistItemModel(sequelize),
  ShippingZone: initShippingZoneModel(sequelize),
  ShippingRate: initShippingRateModel(sequelize),
  Shipment: initShipmentModel(sequelize),
  ReturnRequest: initReturnRequestModel(sequelize),
  TaxRule: initTaxRuleModel(sequelize),
  NotificationLog: initNotificationLogModel(sequelize),
  AuditLog: initAuditLogModel(sequelize),
  WebhookEvent: initWebhookEventModel(sequelize),
  HelpTicket: initHelpTicketModel(sequelize),
  PlatformSetting: initPlatformSettingModel(sequelize),
  PromoBanner: initPromoBannerModel(sequelize),
};

Object.values(models).forEach((model: any) => {
  if (typeof model.associate === 'function') {
    model.associate(models);
  }
});

export { sequelize };
export {
  Role, Permission, Vendor, User, RefreshToken, Address,
  VendorDocument, Category, CategoryAttribute, Product, ProductCategory, ProductVariant, ProductImage,
  Cart, CartItem, Order, SubOrder, OrderItem,
  Coupon, CouponBatch, CouponUsage, WalletLedger, CommissionLedger, Payout,
  Review, ReviewVote, Wishlist, WishlistItem,
  ShippingZone, ShippingRate, Shipment, ReturnRequest,
  TaxRule, NotificationLog, AuditLog, WebhookEvent, HelpTicket,
  PlatformSetting, PromoBanner,
};
