import { Model, DataTypes, Sequelize, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';

export type NotificationType =
  | 'EMAIL_VERIFICATION' | 'PASSWORD_RESET' | 'WELCOME'
  | 'ORDER_CONFIRMATION' | 'VENDOR_NEW_ORDER' | 'PAYMENT_RECEIPT' | 'PAYMENT_FAILED'
  | 'SUBORDER_SHIPPED' | 'SUBORDER_DELIVERED' | 'REVIEW_REQUEST'
  | 'ORDER_CANCELLED' | 'ORDER_RETURNED' | 'REFUND_PROCESSED'
  | 'VENDOR_APPLICATION_RECEIVED' | 'VENDOR_APPROVED' | 'VENDOR_REJECTED' | 'VENDOR_SUSPENDED'
  | 'PRODUCT_APPROVED' | 'PRODUCT_REJECTED' | 'KYC_DOCUMENT_REJECTED'
  | 'LOW_STOCK_ALERT' | 'PAYOUT_PROCESSED' | 'PAYOUT_FAILED'
  | 'ABANDONED_CART' | 'PRICE_DROP_ALERT' | 'BACK_IN_STOCK' | 'ADMIN_NEW_VENDOR_PENDING'
  | 'COUPON_USAGE_LIMIT' | 'COUPON_EXPIRING' | 'COUPON_OFFER_EXPIRING';

export class NotificationLog extends Model<InferAttributes<NotificationLog>, InferCreationAttributes<NotificationLog>> {
  declare id: CreationOptional<string>;
  declare userId: string;
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
}

export const initNotificationLogModel = (sequelize: Sequelize) => {
  NotificationLog.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      userId: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      referenceType: { type: DataTypes.STRING, allowNull: false },
      referenceId: { type: DataTypes.UUID, allowNull: false },
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
