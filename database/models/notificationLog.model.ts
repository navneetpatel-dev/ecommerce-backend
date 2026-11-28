import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type NotificationType =
  | 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'LOGIN_OTP' | 'WELCOME'
  | 'ORDER_CONFIRMATION' | 'VENDOR_NEW_ORDER' | 'PAYMENT_RECEIPT' | 'PAYMENT_FAILED'
  | 'SUBORDER_SHIPPED' | 'SUBORDER_DELIVERED' | 'SUBORDER_CANCELLED' | 'REVIEW_REQUEST'
  | 'ORDER_CANCELLED' | 'ORDER_RETURNED' | 'REFUND_PROCESSED' | 'REFUND_INITIATED'
  | 'WALLET_RECHARGE_FAILED'
  | 'VENDOR_APPLICATION_RECEIVED' | 'VENDOR_APPROVED' | 'VENDOR_REJECTED' | 'VENDOR_SUSPENDED'
  | 'PRODUCT_APPROVED' | 'PRODUCT_REJECTED' | 'KYC_DOCUMENT_REJECTED'
  | 'PRODUCT_LISTED_BY_PLATFORM' | 'PRODUCT_UPDATED_BY_PLATFORM' | 'PRODUCT_SUBMITTED_BY_PLATFORM'
  | 'PRODUCT_ABOVE_MRP'
  | 'STOCK_ALERT_REQUESTED' | 'STOCK_ALERT_CONFIRMED'
  | 'LOW_STOCK_ALERT' | 'PAYOUT_PROCESSED' | 'PAYOUT_FAILED'
  | 'PAYOUT_PAID'
  | 'ABANDONED_CART' | 'PRICE_DROP_ALERT' | 'BACK_IN_STOCK' | 'ADMIN_NEW_VENDOR_PENDING'
  | 'COUPON_USAGE_LIMIT' | 'COUPON_EXPIRING' | 'COUPON_OFFER_EXPIRING'
  | 'TICKET_CREATED' | 'TICKET_REPLIED' | 'TICKET_RESOLVED' | 'TICKET_REOPENED'
  | 'QUESTION_ANSWERED' | 'REVIEW_REPLIED' | 'VENDOR_ORDER_CANCELLED'
  | 'BUG_REPORT_TRIAGED' | 'BUG_REPORT_FIXED' | 'BUG_REPORT_WONT_FIX' | 'BUG_REPORT_DUPLICATE'
  | 'DELIVERY_ATTEMPT_FAILED'
  | 'ADMIN_BROADCAST'
  | 'PASSWORD_CHANGED' | 'NEW_DEVICE_LOGIN' | 'ACCOUNT_DEACTIVATED' | 'ACCOUNT_REACTIVATED'
  | 'NEWSLETTER_CONFIRM' | 'NEWSLETTER_WELCOME' | 'NEWSLETTER_UNSUBSCRIBED'
  | 'CONTACT_ACKNOWLEDGEMENT'
  | 'WALLET_RECHARGE_SUCCESS' | 'CASHBACK_CREDITED' | 'POINTS_EXPIRING'
  | 'GIFT_CARD_PURCHASED' | 'GIFT_CARD_RECEIVED' | 'GIFT_CARD_REDEEMED'
  | 'ORDER_OUT_FOR_DELIVERY' | 'CHECKOUT_PAYMENT_PENDING' | 'CHECKOUT_EXPIRED'
  | 'RETURN_REQUESTED' | 'RETURN_APPROVED' | 'RETURN_REJECTED' | 'RETURN_PICKUP_SCHEDULED' | 'RETURN_RECEIVED'
  | 'TICKET_AUTO_CLOSED' | 'TICKET_REOPEN_WINDOW_ENDING'
  | 'REVIEW_PUBLISHED' | 'REVIEW_REJECTED' | 'WISHLIST_DIGEST'
  | 'KYC_DOCUMENT_RECEIVED' | 'KYC_DOCUMENT_APPROVED' | 'KYC_PENDING_REMINDER'
  | 'VENDOR_STAFF_INVITE' | 'VENDOR_STAFF_ROLE_CHANGED'
  | 'VENDOR_RETURN_REQUESTED' | 'VENDOR_NEW_QUESTION' | 'VENDOR_NEW_REVIEW'
  | 'COMMISSION_INVOICE_READY' | 'VENDOR_WEEKLY_SUMMARY'
  | 'ADMIN_RETURN_ESCALATION' | 'ADMIN_NEW_BUG_REPORT' | 'ADMIN_CONTACT_ENQUIRY'
  | 'ADMIN_SETTINGS_CHANGED' | 'ADMIN_DAILY_DIGEST' | 'ADMIN_VENDOR_PRODUCT_EDITED';

export class NotificationLog extends Model<InferAttributes<NotificationLog>, InferCreationAttributes<NotificationLog>> {
  declare id: CreationOptional<string>;
  declare userId: string | null;
  /** Set when the recipient is not a registered user (subscriber, contact enquiry, gift-card recipient). */
  declare recipientEmail: string | null;
  /** What the email is rendered from, kept so a stuck or failed email can be re-sent. */
  declare payload: Record<string, unknown> | null;
  declare attempts: CreationOptional<number>;
  /** Why it failed: TEMPORARY, PERMANENT, RENDER, RECIPIENT, CONFIG or UNCERTAIN (null when it did not fail). */
  declare errorCategory: CreationOptional<string | null>;
  /** Set when a send starts; a leftover value means a worker died mid-send. */
  declare sendingAt: CreationOptional<Date | null>;
  declare type: NotificationType;
  declare referenceType: string;
  declare referenceId: string;
  declare channel: CreationOptional<'EMAIL' | 'SMS' | 'PUSH'>;
  declare status: 'PENDING' | 'SENT' | 'FAILED' | 'BOUNCED' | 'COMPLAINED';
  declare providerMessageId: string | null;
  declare error: string | null;
  declare sentAt: Date | null;
  declare createdBy: string | null;
  declare updatedBy: string | null;
  declare deletedBy: string | null;
  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
  declare readonly deletedAt: CreationOptional<Date>;

  static associate(models: Record<string, any>) {
    NotificationLog.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  }
}

export const initNotificationLogModel = (sequelize: Sequelize) => {
  NotificationLog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: true },
      recipientEmail: { type: DataTypes.STRING(255), allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: true },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      errorCategory: { type: DataTypes.STRING(20), allowNull: true },
      sendingAt: { type: DataTypes.DATE, allowNull: true },
      type: { type: DataTypes.STRING, allowNull: false },
      referenceType: { type: DataTypes.STRING, allowNull: false },
      referenceId: { type: DataTypes.STRING(191), allowNull: false },
      channel: { type: DataTypes.ENUM('EMAIL', 'SMS', 'PUSH'), defaultValue: 'EMAIL' },
      status: { type: DataTypes.ENUM('PENDING', 'SENT', 'FAILED', 'BOUNCED', 'COMPLAINED'), defaultValue: 'PENDING' },
      providerMessageId: { type: DataTypes.STRING, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      sentAt: { type: DataTypes.DATE, allowNull: true },
      createdBy: { type: DataTypes.UUID, allowNull: true },
      updatedBy: { type: DataTypes.UUID, allowNull: true },
      deletedBy: { type: DataTypes.UUID, allowNull: true },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
      deletedAt: DataTypes.DATE,
    },
    { sequelize, tableName: 'notification_logs', timestamps: true, paranoid: true },
  );
  return NotificationLog;
};
