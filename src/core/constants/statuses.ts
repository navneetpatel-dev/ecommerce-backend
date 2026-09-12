/** Domain status / method enums — keep identical to Sequelize model ENUM values. */

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
export const ORDER_STATUS_VALUES = Object.values(ORDER_STATUS) as [OrderStatus, ...OrderStatus[]];

/** SubOrder statuses from which a full order/checkout cancellation is still allowed (pre-shipment only). */
export const CANCELLABLE_SUB_STATUSES = new Set<string>([ORDER_STATUS.PENDING, ORDER_STATUS.CONFIRMED]);

/**
 * True only when every suborder is still in a cancellable (pre-shipment) status. Shared by every
 * full-order-cancellation path (checkout.service.ts, payments.service.ts, ordersCancel.service.ts)
 * so the rule can't drift between them — each caller still decides how to react to `false`
 * (throw vs. silently no-op), since that differs by context (user-facing request vs. a webhook
 * handler's best-effort cleanup).
 */
export function allSubOrdersCancellable(subOrders: { status: string }[]): boolean {
  return subOrders.every((subOrder) => CANCELLABLE_SUB_STATUSES.has(subOrder.status));
}

export const PAYMENT_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];
export const PAYMENT_STATUS_VALUES = Object.values(PAYMENT_STATUS) as [PaymentStatus, ...PaymentStatus[]];

export const PRODUCT_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  LIVE: 'LIVE',
  REJECTED: 'REJECTED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[keyof typeof PRODUCT_STATUS];
export const PRODUCT_STATUS_VALUES = Object.values(PRODUCT_STATUS) as [ProductStatus, ...ProductStatus[]];

export const VENDOR_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type VendorStatus = (typeof VENDOR_STATUS)[keyof typeof VENDOR_STATUS];
export const VENDOR_STATUS_VALUES = Object.values(VENDOR_STATUS) as [VendorStatus, ...VendorStatus[]];

export const VENDOR_ENTITY_TYPE = {
  SOLE_PROPRIETORSHIP: 'SOLE_PROPRIETORSHIP',
  PARTNERSHIP: 'PARTNERSHIP',
  LLP: 'LLP',
  PRIVATE_LIMITED: 'PRIVATE_LIMITED',
} as const;
export type VendorEntityType = (typeof VENDOR_ENTITY_TYPE)[keyof typeof VENDOR_ENTITY_TYPE];
export const VENDOR_ENTITY_TYPE_VALUES = Object.values(VENDOR_ENTITY_TYPE) as [
  VendorEntityType,
  ...VendorEntityType[],
];

/** Checklist status for a required KYC document type. */
export const VENDOR_DOCUMENT_CHECKLIST_STATUS = {
  NOT_UPLOADED: 'NOT_UPLOADED',
  PENDING_REVIEW: 'PENDING_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
export type VendorDocumentChecklistStatus =
  (typeof VENDOR_DOCUMENT_CHECKLIST_STATUS)[keyof typeof VENDOR_DOCUMENT_CHECKLIST_STATUS];
export const VENDOR_DOCUMENT_CHECKLIST_STATUS_VALUES = Object.values(
  VENDOR_DOCUMENT_CHECKLIST_STATUS,
) as [VendorDocumentChecklistStatus, ...VendorDocumentChecklistStatus[]];

/** Why a cart/wishlist line is not purchaseable (live catalog gate). */
export const UNAVAILABLE_REASON = {
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  PRODUCT_UNPUBLISHED: 'PRODUCT_UNPUBLISHED',
  VENDOR_UNAVAILABLE: 'VENDOR_UNAVAILABLE',
} as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASON)[keyof typeof UNAVAILABLE_REASON];

export const CATEGORY_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type CategoryStatus = (typeof CATEGORY_STATUS)[keyof typeof CATEGORY_STATUS];
export const CATEGORY_STATUS_VALUES = Object.values(CATEGORY_STATUS) as [CategoryStatus, ...CategoryStatus[]];

export const CATEGORY_ATTRIBUTE_TYPE = {
  ENUM: 'ENUM',
  RANGE: 'RANGE',
  BOOLEAN: 'BOOLEAN',
} as const;
export type CategoryAttributeType =
  (typeof CATEGORY_ATTRIBUTE_TYPE)[keyof typeof CATEGORY_ATTRIBUTE_TYPE];
export const CATEGORY_ATTRIBUTE_TYPE_VALUES = Object.values(CATEGORY_ATTRIBUTE_TYPE) as [
  CategoryAttributeType,
  ...CategoryAttributeType[],
];

export const PROMO_BANNER_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type PromoBannerStatus = (typeof PROMO_BANNER_STATUS)[keyof typeof PROMO_BANNER_STATUS];
export const PROMO_BANNER_STATUS_VALUES = Object.values(PROMO_BANNER_STATUS) as [
  PromoBannerStatus,
  ...PromoBannerStatus[],
];

export const PROMO_BANNER_LINK_TYPE = {
  PRODUCT: 'PRODUCT',
  CATEGORY: 'CATEGORY',
  VENDOR: 'VENDOR',
  URL: 'URL',
} as const;
export type PromoBannerLinkType = (typeof PROMO_BANNER_LINK_TYPE)[keyof typeof PROMO_BANNER_LINK_TYPE];
export const PROMO_BANNER_LINK_TYPE_VALUES = Object.values(PROMO_BANNER_LINK_TYPE) as [
  PromoBannerLinkType,
  ...PromoBannerLinkType[],
];

export const VENDOR_DOCUMENT_TYPE = {
  GST_CERT: 'GST_CERT',
  PAN: 'PAN',
  AADHAAR: 'AADHAAR',
  BANK_PROOF: 'BANK_PROOF',
  ADDRESS_PROOF: 'ADDRESS_PROOF',
  INCORPORATION_CERT: 'INCORPORATION_CERT',
  PARTNERSHIP_DEED: 'PARTNERSHIP_DEED',
  AUTHORIZED_SIGNATORY_ID: 'AUTHORIZED_SIGNATORY_ID',
  FSSAI_LICENSE: 'FSSAI_LICENSE',
  CATEGORY_TRADE_LICENSE: 'CATEGORY_TRADE_LICENSE',
} as const;
export type VendorDocumentType = (typeof VENDOR_DOCUMENT_TYPE)[keyof typeof VENDOR_DOCUMENT_TYPE];
export const VENDOR_DOCUMENT_TYPE_VALUES = Object.values(VENDOR_DOCUMENT_TYPE) as [
  VendorDocumentType,
  ...VendorDocumentType[],
];

export const DELIVERY_AGENT_DOCUMENT_TYPE = {
  ID_PROOF: 'ID_PROOF',
  DRIVING_LICENSE: 'DRIVING_LICENSE',
  VEHICLE_RC: 'VEHICLE_RC',
  ADDRESS_PROOF: 'ADDRESS_PROOF',
} as const;
export type DeliveryAgentDocumentType =
  (typeof DELIVERY_AGENT_DOCUMENT_TYPE)[keyof typeof DELIVERY_AGENT_DOCUMENT_TYPE];
export const DELIVERY_AGENT_DOCUMENT_TYPE_VALUES = Object.values(DELIVERY_AGENT_DOCUMENT_TYPE) as [
  DeliveryAgentDocumentType,
  ...DeliveryAgentDocumentType[],
];
/** Both must be APPROVED before an agent can go "available for assignment". */
export const DELIVERY_AGENT_REQUIRED_DOCUMENT_TYPES: readonly DeliveryAgentDocumentType[] = [
  DELIVERY_AGENT_DOCUMENT_TYPE.ID_PROOF,
  DELIVERY_AGENT_DOCUMENT_TYPE.DRIVING_LICENSE,
];

export const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
} as const;
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];
export const USER_STATUS_VALUES = Object.values(USER_STATUS) as [UserStatus, ...UserStatus[]];

export const REVIEW_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];
export const REVIEW_STATUS_VALUES = Object.values(REVIEW_STATUS) as [ReviewStatus, ...ReviewStatus[]];

/** Pre-moderation gate for customer-submitted product questions — mirrors REVIEW_STATUS. */
export const PRODUCT_QUESTION_STATUS = {
  PENDING: 'PENDING',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED',
} as const;
export type ProductQuestionStatus = (typeof PRODUCT_QUESTION_STATUS)[keyof typeof PRODUCT_QUESTION_STATUS];
export const PRODUCT_QUESTION_STATUS_VALUES = Object.values(PRODUCT_QUESTION_STATUS) as [
  ProductQuestionStatus,
  ...ProductQuestionStatus[],
];

/** Who wrote a product-question answer — VENDOR when the answering user owns the product. */
export const PRODUCT_ANSWER_AUTHOR_TYPE = {
  VENDOR: 'VENDOR',
  CUSTOMER: 'CUSTOMER',
} as const;
export type ProductAnswerAuthorType =
  (typeof PRODUCT_ANSWER_AUTHOR_TYPE)[keyof typeof PRODUCT_ANSWER_AUTHOR_TYPE];
export const PRODUCT_ANSWER_AUTHOR_TYPE_VALUES = Object.values(PRODUCT_ANSWER_AUTHOR_TYPE) as [
  ProductAnswerAuthorType,
  ...ProductAnswerAuthorType[],
];

export const RETURN_STATUS = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PICKUP_SCHEDULED: 'PICKUP_SCHEDULED',
  RECEIVED: 'RECEIVED',
  REFUNDED: 'REFUNDED',
  CLOSED: 'CLOSED',
} as const;
export type ReturnStatus = (typeof RETURN_STATUS)[keyof typeof RETURN_STATUS];
export const RETURN_STATUS_VALUES = Object.values(RETURN_STATUS) as [ReturnStatus, ...ReturnStatus[]];

export const RETURN_REASON = {
  DAMAGED: 'DAMAGED',
  WRONG_ITEM: 'WRONG_ITEM',
  NOT_AS_DESCRIBED: 'NOT_AS_DESCRIBED',
  NO_LONGER_NEEDED: 'NO_LONGER_NEEDED',
  OTHER: 'OTHER',
} as const;
export type ReturnReason = (typeof RETURN_REASON)[keyof typeof RETURN_REASON];
export const RETURN_REASON_VALUES = Object.values(RETURN_REASON) as [ReturnReason, ...ReturnReason[]];

/** How the customer receives the refund (never bank/UPI collection). */
export const REFUND_METHOD = {
  RAZORPAY: 'RAZORPAY',
  WALLET_CREDIT: 'WALLET_CREDIT',
} as const;
export type RefundMethod = (typeof REFUND_METHOD)[keyof typeof REFUND_METHOD];
export const REFUND_METHOD_VALUES = Object.values(REFUND_METHOD) as [RefundMethod, ...RefundMethod[]];

export const RETURN_TYPE = {
  REFUND: 'REFUND',
  EXCHANGE: 'EXCHANGE',
} as const;
export type ReturnType = (typeof RETURN_TYPE)[keyof typeof RETURN_TYPE];
export const RETURN_TYPE_VALUES = Object.values(RETURN_TYPE) as [ReturnType, ...ReturnType[]];

/** Parallel refund-track status (independent of logistics status). */
export const REFUND_STATUS = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  INITIATED: 'INITIATED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];
export const REFUND_STATUS_VALUES = Object.values(REFUND_STATUS) as [RefundStatus, ...RefundStatus[]];

export const WALLET_LEDGER_TYPE = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;
export type WalletLedgerType = (typeof WALLET_LEDGER_TYPE)[keyof typeof WALLET_LEDGER_TYPE];

export const WALLET_REFERENCE_TYPE = {
  ORDER: 'ORDER',
  RETURN: 'RETURN',
  CASHBACK: 'CASHBACK',
  CLAWBACK: 'CLAWBACK',
  COD_REFUND: 'COD_REFUND',
  WALLET_REFUND: 'WALLET_REFUND',
  TOPUP: 'TOPUP',
  ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',
  EXPIRY: 'EXPIRY',
} as const;

export const WALLET_POINT_SOURCE = {
  PURCHASED: 'PURCHASED',
  PROMOTIONAL: 'PROMOTIONAL',
} as const;
export type WalletPointSource =
  (typeof WALLET_POINT_SOURCE)[keyof typeof WALLET_POINT_SOURCE];

export const COMMISSION_REFERENCE_TYPE = {
  CASHBACK_COST: 'CashbackCost',
  CASHBACK_COST_REVERSAL: 'CashbackCostReversal',
} as const;

export const SHIPMENT_STATUS = {
  PENDING: 'PENDING',
  PICKED_UP: 'PICKED_UP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS)[keyof typeof SHIPMENT_STATUS];

export const SHIPPING_METHOD = {
  STANDARD: 'STANDARD',
  EXPRESS: 'EXPRESS',
} as const;
export type ShippingMethod = (typeof SHIPPING_METHOD)[keyof typeof SHIPPING_METHOD];
export const SHIPPING_METHOD_VALUES = Object.values(SHIPPING_METHOD) as [ShippingMethod, ...ShippingMethod[]];

export const PAYMENT_METHOD = {
  RAZORPAY: 'RAZORPAY',
  COD: 'COD',
} as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];
export const PAYMENT_METHOD_VALUES = Object.values(PAYMENT_METHOD) as [PaymentMethod, ...PaymentMethod[]];

export const WARRANTY_TYPE = {
  MANUFACTURER: 'MANUFACTURER',
  SELLER: 'SELLER',
} as const;
export type WarrantyType = (typeof WARRANTY_TYPE)[keyof typeof WARRANTY_TYPE];
export const WARRANTY_TYPE_VALUES = Object.values(WARRANTY_TYPE) as [WarrantyType, ...WarrantyType[]];

export const COUPON_STATUS = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  EXPIRED: 'EXPIRED',
  ARCHIVED: 'ARCHIVED',
  REJECTED: 'REJECTED',
} as const;
export type CouponStatus = (typeof COUPON_STATUS)[keyof typeof COUPON_STATUS];
export const COUPON_STATUS_VALUES = Object.values(COUPON_STATUS) as [CouponStatus, ...CouponStatus[]];

export const DISCOUNT_BEARER = {
  PLATFORM: 'PLATFORM',
  VENDOR: 'VENDOR',
} as const;
export type DiscountBearer = (typeof DISCOUNT_BEARER)[keyof typeof DISCOUNT_BEARER];
export const DISCOUNT_BEARER_VALUES = Object.values(DISCOUNT_BEARER) as [
  DiscountBearer,
  ...DiscountBearer[],
];

/** Sequential GST document number series (credit / debit notes). */
export const DOCUMENT_SEQUENCE_KIND = {
  CREDIT_NOTE: 'CREDIT_NOTE',
  DEBIT_NOTE: 'DEBIT_NOTE',
  TAX_INVOICE: 'TAX_INVOICE',
  SUPPORT_TICKET: 'SUPPORT_TICKET',
  BUG_REPORT: 'BUG_REPORT',
} as const;
export type DocumentSequenceKind =
  (typeof DOCUMENT_SEQUENCE_KIND)[keyof typeof DOCUMENT_SEQUENCE_KIND];
export const DOCUMENT_SEQUENCE_KIND_VALUES = Object.values(DOCUMENT_SEQUENCE_KIND) as [
  DocumentSequenceKind,
  ...DocumentSequenceKind[],
];

export const SUPPORT_TICKET_STATUS = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  REOPENED: 'REOPENED',
} as const;
export type SupportTicketStatus =
  (typeof SUPPORT_TICKET_STATUS)[keyof typeof SUPPORT_TICKET_STATUS];
export const SUPPORT_TICKET_STATUS_VALUES = Object.values(SUPPORT_TICKET_STATUS) as [
  SupportTicketStatus,
  ...SupportTicketStatus[],
];

export const SUPPORT_TICKET_CATEGORY = {
  ORDER: 'ORDER',
  PRODUCT: 'PRODUCT',
  PAYMENT: 'PAYMENT',
  VENDOR: 'VENDOR',
  OTHER: 'OTHER',
} as const;
export type SupportTicketCategory =
  (typeof SUPPORT_TICKET_CATEGORY)[keyof typeof SUPPORT_TICKET_CATEGORY];
export const SUPPORT_TICKET_CATEGORY_VALUES = Object.values(SUPPORT_TICKET_CATEGORY) as [
  SupportTicketCategory,
  ...SupportTicketCategory[],
];

export const SUPPORT_TICKET_PRIORITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type SupportTicketPriority =
  (typeof SUPPORT_TICKET_PRIORITY)[keyof typeof SUPPORT_TICKET_PRIORITY];
export const SUPPORT_TICKET_PRIORITY_VALUES = Object.values(SUPPORT_TICKET_PRIORITY) as [
  SupportTicketPriority,
  ...SupportTicketPriority[],
];

export const TICKET_ATTACHMENT_TYPE = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
} as const;
export type TicketAttachmentType =
  (typeof TICKET_ATTACHMENT_TYPE)[keyof typeof TICKET_ATTACHMENT_TYPE];
export const TICKET_ATTACHMENT_TYPE_VALUES = Object.values(TICKET_ATTACHMENT_TYPE) as [
  TicketAttachmentType,
  ...TicketAttachmentType[],
];

/** Stored sender role on ticket messages (VENDOR_OWNER maps to VENDOR). */
export const TICKET_SENDER_ROLE = {
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
  VENDOR_STAFF: 'VENDOR_STAFF',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN_ORDER_MANAGER: 'ADMIN_ORDER_MANAGER',
  ADMIN_CATALOG_MANAGER: 'ADMIN_CATALOG_MANAGER',
} as const;
export type TicketSenderRole = (typeof TICKET_SENDER_ROLE)[keyof typeof TICKET_SENDER_ROLE];
export const TICKET_SENDER_ROLE_VALUES = Object.values(TICKET_SENDER_ROLE) as [
  TicketSenderRole,
  ...TicketSenderRole[],
];

export const BUG_REPORT_STATUS = {
  NEW: 'NEW',
  TRIAGED: 'TRIAGED',
  IN_PROGRESS: 'IN_PROGRESS',
  FIXED: 'FIXED',
  VERIFIED: 'VERIFIED',
  CLOSED: 'CLOSED',
  WONT_FIX: 'WONT_FIX',
  DUPLICATE: 'DUPLICATE',
} as const;
export type BugReportStatus = (typeof BUG_REPORT_STATUS)[keyof typeof BUG_REPORT_STATUS];
export const BUG_REPORT_STATUS_VALUES = Object.values(BUG_REPORT_STATUS) as [
  BugReportStatus,
  ...BugReportStatus[],
];

export const BUG_REPORT_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type BugReportSeverity = (typeof BUG_REPORT_SEVERITY)[keyof typeof BUG_REPORT_SEVERITY];
export const BUG_REPORT_SEVERITY_VALUES = Object.values(BUG_REPORT_SEVERITY) as [
  BugReportSeverity,
  ...BugReportSeverity[],
];

export const BUG_AFFECTED_MODULE = {
  CATALOG: 'CATALOG',
  CART: 'CART',
  CHECKOUT: 'CHECKOUT',
  PAYMENTS: 'PAYMENTS',
  ORDERS: 'ORDERS',
  VENDOR_DASHBOARD: 'VENDOR_DASHBOARD',
  ADMIN_DASHBOARD: 'ADMIN_DASHBOARD',
  OTHER: 'OTHER',
} as const;
export type BugAffectedModule = (typeof BUG_AFFECTED_MODULE)[keyof typeof BUG_AFFECTED_MODULE];
export const BUG_AFFECTED_MODULE_VALUES = Object.values(BUG_AFFECTED_MODULE) as [
  BugAffectedModule,
  ...BugAffectedModule[],
];

export const BUG_REPORTER_ROLE = {
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
  VENDOR_STAFF: 'VENDOR_STAFF',
} as const;
export type BugReporterRole = (typeof BUG_REPORTER_ROLE)[keyof typeof BUG_REPORTER_ROLE];
export const BUG_REPORTER_ROLE_VALUES = Object.values(BUG_REPORTER_ROLE) as [
  BugReporterRole,
  ...BugReporterRole[],
];

export const BUG_ATTACHMENT_TYPE = {
  SCREENSHOT: 'SCREENSHOT',
  SCREEN_RECORDING: 'SCREEN_RECORDING',
} as const;
export type BugAttachmentType = (typeof BUG_ATTACHMENT_TYPE)[keyof typeof BUG_ATTACHMENT_TYPE];
export const BUG_ATTACHMENT_TYPE_VALUES = Object.values(BUG_ATTACHMENT_TYPE) as [
  BugAttachmentType,
  ...BugAttachmentType[],
];

/** Built-in customer segments for coupon userRestriction.type === 'segment'. */
export const COUPON_USER_SEGMENT = {
  NEW: 'new',
  RETURNING: 'returning',
  LOYAL: 'loyal',
} as const;
export type CouponUserSegment = (typeof COUPON_USER_SEGMENT)[keyof typeof COUPON_USER_SEGMENT];
export const COUPON_USER_SEGMENT_VALUES = Object.values(COUPON_USER_SEGMENT) as [
  CouponUserSegment,
  ...CouponUserSegment[],
];

export const PAYOUT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
} as const;
export type PayoutStatus = (typeof PAYOUT_STATUS)[keyof typeof PAYOUT_STATUS];
export const PAYOUT_STATUS_VALUES = Object.values(PAYOUT_STATUS) as [PayoutStatus, ...PayoutStatus[]];

/**
 * Vendor's preferred payout cadence — storage/display only. `null` means "no
 * preference set"; there is no platform-wide default cadence constant today, so
 * a null value is simply shown as "no preference" rather than falling back to a
 * concrete cadence. NOT wired into payout processing — POST /payouts/process
 * stays a manual, admin-run batch job regardless of this field.
 */
export const PAYOUT_FREQUENCY = {
  WEEKLY: 'WEEKLY',
  BIWEEKLY: 'BIWEEKLY',
  MONTHLY: 'MONTHLY',
} as const;
export type PayoutFrequency = (typeof PAYOUT_FREQUENCY)[keyof typeof PAYOUT_FREQUENCY];
export const PAYOUT_FREQUENCY_VALUES = Object.values(PAYOUT_FREQUENCY) as [PayoutFrequency, ...PayoutFrequency[]];

export const COMMISSION_STATUS = {
  PENDING: 'PENDING',
  SETTLED: 'SETTLED',
  CLAWED_BACK: 'CLAWED_BACK',
} as const;

export const NOTIFICATION_STATUS = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  BOUNCED: 'BOUNCED',
  COMPLAINED: 'COMPLAINED',
} as const;

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN_ORDER_MANAGER: 'ADMIN_ORDER_MANAGER',
  ADMIN_CATALOG_MANAGER: 'ADMIN_CATALOG_MANAGER',
  VENDOR_OWNER: 'VENDOR_OWNER',
  VENDOR_STAFF: 'VENDOR_STAFF',
  DELIVERY_AGENT: 'DELIVERY_AGENT',
  CUSTOMER: 'CUSTOMER',
} as const;
export type RoleName = (typeof ROLES)[keyof typeof ROLES];
export const ROLE_VALUES = Object.values(ROLES) as [RoleName, ...RoleName[]];

/** Human-readable role names for login account picker. */
export const ROLE_LABELS: Record<RoleName, string> = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.ADMIN_ORDER_MANAGER]: 'Order Manager',
  [ROLES.ADMIN_CATALOG_MANAGER]: 'Catalog Manager',
  [ROLES.VENDOR_OWNER]: 'Vendor Owner',
  [ROLES.VENDOR_STAFF]: 'Vendor Staff',
  [ROLES.DELIVERY_AGENT]: 'Delivery Agent',
  [ROLES.CUSTOMER]: 'Customer',
};

export const ADMIN_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN_ORDER_MANAGER,
  ROLES.ADMIN_CATALOG_MANAGER,
] as const;

export const VENDOR_ROLES = [ROLES.VENDOR_OWNER, ROLES.VENDOR_STAFF] as const;
export const DELIVERY_ROLES = [ROLES.DELIVERY_AGENT] as const;

export const GIFT_CARD_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  REDEEMED: 'REDEEMED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type GiftCardStatus = (typeof GIFT_CARD_STATUS)[keyof typeof GIFT_CARD_STATUS];
