import { sequelize } from '@config/db';
import { initRoleModel, Role } from './role.model';
import { initPermissionModel, Permission } from './permission.model';
import { initVendorModel, Vendor } from './vendor.model';
import { initUserModel, User } from './user.model';
import { initRefreshTokenModel, RefreshToken } from './refreshToken.model';
import { initAddressModel, Address } from './address.model';
import { initVendorDocumentModel, VendorDocument } from './vendorDocument.model';
import { initVendorCategoryModel, VendorCategory } from './vendorCategory.model';
import { initDocumentRequirementModel, DocumentRequirement } from './documentRequirement.model';
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
import { initCommissionLedgerModel, CommissionLedger } from './commissionLedger.model';
import { initPayoutModel, Payout } from './payout.model';
import { initReviewModel, Review } from './review.model';
import { initReviewVoteModel, ReviewVote } from './reviewVote.model';
import { initWishlistModel, Wishlist } from './wishlist.model';
import { initWishlistItemModel, WishlistItem } from './wishlistItem.model';
import { initShippingZoneModel, ShippingZone } from './shippingZone.model';
import { initShippingRateModel, ShippingRate } from './shippingRate.model';
import { initShipmentModel, Shipment } from './shipment.model';
import { initShipmentAttemptModel, ShipmentAttempt } from './shipmentAttempt.model';
import { initReturnRequestModel, ReturnRequest } from './returnRequest.model';
import { initTaxRuleModel, TaxRule } from './taxRule.model';
import { initNotificationLogModel, NotificationLog } from './notificationLog.model';
import { initAuditLogModel, AuditLog } from './auditLog.model';
import { initWebhookEventModel, WebhookEvent } from './webhookEvent.model';
import { initPlatformSettingModel, PlatformSetting } from './platformSetting.model';
import { initPromoBannerModel, PromoBanner } from './promoBanner.model';
import { initTcsLedgerModel, TcsLedger } from './tcsLedger.model';
import { initTdsLedgerModel, TdsLedger } from './tdsLedger.model';
import { initCreditNoteModel, CreditNote } from './creditNote.model';
import { initDebitNoteModel, DebitNote } from './debitNote.model';
import { initDocumentSequenceModel, DocumentSequence } from './documentSequence.model';
import {
  initVendorInvoiceSequenceModel,
  VendorInvoiceSequence,
} from './vendorInvoiceSequence.model';
import {
  initCommissionInvoiceModel,
  CommissionInvoice,
} from './commissionInvoice.model';
import { initWalletLedgerModel, WalletLedger } from './walletLedger.model';
import { initWalletWriteOffModel, WalletWriteOff } from './walletWriteOff.model';
import {
  initWalletRechargeOrderModel,
  WalletRechargeOrder,
} from './walletRechargeOrder.model';
import { initSupportTicketModel, SupportTicket } from './supportTicket.model';
import { initTicketMessageModel, TicketMessage } from './ticketMessage.model';
import { initTicketAttachmentModel, TicketAttachment } from './ticketAttachment.model';
import { initTicketReadModel, TicketRead } from './ticketRead.model';
import { initBugReportModel, BugReport } from './bugReport.model';
import { initBugReportAttachmentModel, BugReportAttachment } from './bugReportAttachment.model';
import { initBugReportCommentModel, BugReportComment } from './bugReportComment.model';
import { initNewsletterSubscriberModel, NewsletterSubscriber } from './newsletterSubscriber.model';
import { initOtpCodeModel, OtpCode } from './otpCode.model';
import { initPushSubscriptionModel, PushSubscription } from './pushSubscription.model';
import { initDeliveryAgentModel, DeliveryAgent } from './deliveryAgent.model';
import { initDeliveryCashDepositModel, DeliveryCashDeposit } from './deliveryCashDeposit.model';
import { initDeliveryAgentEarningModel, DeliveryAgentEarning } from './deliveryAgentEarning.model';
import { initDeliveryAgentPayoutModel, DeliveryAgentPayout } from './deliveryAgentPayout.model';
import { initDeliveryAgentDocumentModel, DeliveryAgentDocument } from './deliveryAgentDocument.model';
import { initDeliveryRatingModel, DeliveryRating } from './deliveryRating.model';
import { initWebVitalModel, WebVital } from './webVital.model';
import { initRecentlyViewedItemModel, RecentlyViewedItem } from './recentlyViewedItem.model';
import { initSavedPaymentMethodModel, SavedPaymentMethod } from './savedPaymentMethod.model';
import { initStockAlertModel, StockAlert } from './stockAlert.model';
import { initProductAffinityModel, ProductAffinity } from './productAffinity.model';
import { initGiftCardModel, GiftCard } from './giftCard.model';
import { initProductQuestionModel, ProductQuestion } from './productQuestion.model';
import { initProductAnswerModel, ProductAnswer } from './productAnswer.model';
import { initExportJobModel, ExportJob } from './exportJob.model';

const models = {
  Role: initRoleModel(sequelize),
  Permission: initPermissionModel(sequelize),
  Vendor: initVendorModel(sequelize),
  DeliveryAgent: initDeliveryAgentModel(sequelize),
  DeliveryCashDeposit: initDeliveryCashDepositModel(sequelize),
  DeliveryAgentPayout: initDeliveryAgentPayoutModel(sequelize),
  DeliveryAgentDocument: initDeliveryAgentDocumentModel(sequelize),
  DeliveryRating: initDeliveryRatingModel(sequelize),
  DeliveryAgentEarning: initDeliveryAgentEarningModel(sequelize),
  User: initUserModel(sequelize),
  RefreshToken: initRefreshTokenModel(sequelize),
  Address: initAddressModel(sequelize),
  VendorDocument: initVendorDocumentModel(sequelize),
  VendorCategory: initVendorCategoryModel(sequelize),
  DocumentRequirement: initDocumentRequirementModel(sequelize),
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
  CommissionLedger: initCommissionLedgerModel(sequelize),
  Payout: initPayoutModel(sequelize),
  Review: initReviewModel(sequelize),
  ReviewVote: initReviewVoteModel(sequelize),
  Wishlist: initWishlistModel(sequelize),
  WishlistItem: initWishlistItemModel(sequelize),
  ShippingZone: initShippingZoneModel(sequelize),
  ShippingRate: initShippingRateModel(sequelize),
  Shipment: initShipmentModel(sequelize),
  ShipmentAttempt: initShipmentAttemptModel(sequelize),
  ReturnRequest: initReturnRequestModel(sequelize),
  TaxRule: initTaxRuleModel(sequelize),
  NotificationLog: initNotificationLogModel(sequelize),
  AuditLog: initAuditLogModel(sequelize),
  WebhookEvent: initWebhookEventModel(sequelize),
  PlatformSetting: initPlatformSettingModel(sequelize),
  PromoBanner: initPromoBannerModel(sequelize),
  TcsLedger: initTcsLedgerModel(sequelize),
  TdsLedger: initTdsLedgerModel(sequelize),
  CreditNote: initCreditNoteModel(sequelize),
  DebitNote: initDebitNoteModel(sequelize),
  DocumentSequence: initDocumentSequenceModel(sequelize),
  VendorInvoiceSequence: initVendorInvoiceSequenceModel(sequelize),
  CommissionInvoice: initCommissionInvoiceModel(sequelize),
  WalletLedger: initWalletLedgerModel(sequelize),
  WalletWriteOff: initWalletWriteOffModel(sequelize),
  WalletRechargeOrder: initWalletRechargeOrderModel(sequelize),
  SupportTicket: initSupportTicketModel(sequelize),
  TicketMessage: initTicketMessageModel(sequelize),
  TicketAttachment: initTicketAttachmentModel(sequelize),
  TicketRead: initTicketReadModel(sequelize),
  BugReport: initBugReportModel(sequelize),
  BugReportAttachment: initBugReportAttachmentModel(sequelize),
  BugReportComment: initBugReportCommentModel(sequelize),
  NewsletterSubscriber: initNewsletterSubscriberModel(sequelize),
  OtpCode: initOtpCodeModel(sequelize),
  PushSubscription: initPushSubscriptionModel(sequelize),
  WebVital: initWebVitalModel(sequelize),
  RecentlyViewedItem: initRecentlyViewedItemModel(sequelize),
  SavedPaymentMethod: initSavedPaymentMethodModel(sequelize),
  StockAlert: initStockAlertModel(sequelize),
  ProductAffinity: initProductAffinityModel(sequelize),
  ProductQuestion: initProductQuestionModel(sequelize),
  ProductAnswer: initProductAnswerModel(sequelize),
  GiftCard: initGiftCardModel(sequelize),
  ExportJob: initExportJobModel(sequelize),
};

Object.values(models).forEach((model: any) => {
  if (typeof model.associate === 'function') {
    model.associate(models);
  }
});

export { sequelize };
export {
  Role, Permission, Vendor, DeliveryAgent, DeliveryCashDeposit, DeliveryAgentPayout, DeliveryAgentEarning, DeliveryAgentDocument, DeliveryRating, User, RefreshToken, Address,
  VendorDocument, VendorCategory, DocumentRequirement, Category, CategoryAttribute, Product, ProductCategory, ProductVariant, ProductImage,
  Cart, CartItem, Order, SubOrder, OrderItem,
  Coupon, CouponBatch, CouponUsage, CommissionLedger, Payout,
  Review, ReviewVote, Wishlist, WishlistItem,
  ShippingZone, ShippingRate, Shipment, ShipmentAttempt, ReturnRequest,
  TaxRule, NotificationLog, AuditLog, WebhookEvent,
  PlatformSetting, PromoBanner,
  TcsLedger, TdsLedger, CreditNote, DebitNote, DocumentSequence,
  VendorInvoiceSequence, CommissionInvoice,
  WalletLedger, WalletWriteOff, WalletRechargeOrder,
  SupportTicket, TicketMessage, TicketAttachment, TicketRead,
  BugReport, BugReportAttachment, BugReportComment,
  NewsletterSubscriber,
  OtpCode,
  PushSubscription,
  WebVital,
  RecentlyViewedItem,
  SavedPaymentMethod,
  StockAlert,
  ProductAffinity,
  ProductQuestion,
  ProductAnswer,
  GiftCard,
  ExportJob,
};
