import { Op } from 'sequelize';
import { randomUUID } from 'crypto';
import { NotificationLog, type NotificationType } from '@database/models/notificationLog.model';
import { User } from '@database/models/user.model';
import { NOTIFICATION_STATUS } from '@core/constants/statuses';
import { logger } from '@core/logger';
import {
  areQueuesReady,
  queues,
  DEFAULT_MARKETING_JOB_OPTIONS,
  DEFAULT_TRANSACTIONAL_JOB_OPTIONS,
} from '@config/queue';
import { isMarketingNotification, type EmailTemplateData } from './templates/registry';
import { EMAIL_COPY, NOTIFICATION_SYSTEM_MESSAGES } from './emailCopy';

export const EMAIL_JOB_NAME = 'notification-delivery';

export type EmailJobPayload = {
  notificationLogId: string;
  type: NotificationType;
  userId: string;
  referenceType: string;
  referenceId: string;
  templateData: EmailTemplateData;
  urgency: 'transactional' | 'marketing';
};

type EnqueueParams = {
  userId: string;
  type: NotificationType;
  referenceType: string;
  referenceId: string;
  templateData?: EmailTemplateData;
  actorId?: string | null;
  /** Force queue choice; defaults from type. */
  urgency?: 'transactional' | 'marketing';
};

function todayBucket(): string {
  return new Date().toISOString().slice(0, 10);
}

export class NotificationsService {
  async listLogs() {
    return NotificationLog.findAll({ limit: 100, order: [['createdAt', 'DESC']] });
  }

  /**
   * Creates (or reuses) a PENDING NotificationLog and enqueues delivery.
   * Never sends synchronously from the request path.
   */
  async enqueue(params: EnqueueParams): Promise<NotificationLog | null> {
    const urgency = params.urgency ?? (isMarketingNotification(params.type) ? 'marketing' : 'transactional');

    const user = await User.findByPk(params.userId, {
      attributes: ['id', 'email', 'name', 'emailMarketingConsent', 'emailSuppressed', 'status'],
    });
    if (!user?.email) {
      logger.warn('Skip notification — user email missing', {
        userId: params.userId,
        type: params.type,
      });
      return null;
    }

    if (urgency === 'marketing') {
      if (!user.emailMarketingConsent) {
        logger.info('Skip marketing notification — no consent', {
          userId: params.userId,
          type: params.type,
        });
        return null;
      }
      if (user.emailSuppressed) {
        logger.info('Skip marketing notification — email suppressed', {
          userId: params.userId,
          type: params.type,
        });
        return null;
      }
    }

    const alreadySent = await NotificationLog.findOne({
      where: {
        type: params.type,
        referenceId: params.referenceId,
        status: NOTIFICATION_STATUS.SENT,
      },
    });
    if (alreadySent) return alreadySent;

    let log = await NotificationLog.findOne({
      where: {
        userId: params.userId,
        type: params.type,
        referenceId: params.referenceId,
        status: { [Op.in]: [NOTIFICATION_STATUS.PENDING, NOTIFICATION_STATUS.FAILED] },
      },
      order: [['createdAt', 'DESC']],
    });

    if (!log) {
      log = await NotificationLog.create({
        userId: params.userId,
        type: params.type,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        channel: 'EMAIL',
        status: NOTIFICATION_STATUS.PENDING,
        providerMessageId: null,
        error: null,
        sentAt: null,
        createdBy: params.actorId ?? params.userId,
        updatedBy: null,
        deletedBy: null,
      });
    } else if (log.status === NOTIFICATION_STATUS.FAILED) {
      await log.update({
        status: NOTIFICATION_STATUS.PENDING,
        error: null,
        updatedBy: params.actorId ?? params.userId,
      });
    }

    const templateData: EmailTemplateData = {
      customerName: user.name,
      name: user.name,
      email: user.email,
      brand: EMAIL_COPY.brandName,
      ...(params.templateData ?? {}),
    };

    await this.addJob({
      notificationLogId: log.id,
      type: params.type,
      userId: params.userId,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      templateData,
      urgency,
    });

    return log;
  }

  private async addJob(payload: EmailJobPayload): Promise<void> {
    if (!areQueuesReady()) {
      logger.warn('Queues unavailable — notification left PENDING', {
        notificationLogId: payload.notificationLogId,
        type: payload.type,
      });
      return;
    }

    const queue =
      payload.urgency === 'marketing' ? queues.emailMarketing : queues.emailTransactional;
    const options =
      payload.urgency === 'marketing'
        ? DEFAULT_MARKETING_JOB_OPTIONS
        : DEFAULT_TRANSACTIONAL_JOB_OPTIONS;

    try {
      await queue.add(EMAIL_JOB_NAME, payload, {
        ...options,
        // BullMQ rejects custom jobId values that contain `:`.
        jobId: `${payload.type}-${payload.referenceId}-${payload.notificationLogId}`.replace(
          /:/g,
          '-',
        ),
      });
    } catch (error) {
      logger.error('Failed to enqueue email job', {
        notificationLogId: payload.notificationLogId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  async createTest(actorId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const type = (body.type as NotificationType) ?? 'WELCOME';
    const userId = String(body.userId ?? actorId);
    const referenceId = String(body.referenceId ?? randomUUID());
    const log = await this.enqueue({
      userId,
      type,
      referenceType: String(body.referenceType ?? 'User'),
      referenceId,
      templateData: (body.templateData as EmailTemplateData) ?? {},
      actorId,
      urgency: isMarketingNotification(type) ? 'marketing' : 'transactional',
    });

    return {
      ...(log?.get({ plain: true }) ?? {}),
      message: NOTIFICATION_SYSTEM_MESSAGES.queuedForDelivery,
    };
  }

  // --- Typed helpers (trigger matrix) ---

  sendEmailVerification(userId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'EMAIL_VERIFICATION',
      referenceType: 'User',
      referenceId: `${userId}:${todayBucket()}`,
      templateData,
    });
  }

  sendPasswordReset(userId: string, templateData: EmailTemplateData) {
    return this.enqueue({
      userId,
      type: 'PASSWORD_RESET',
      referenceType: 'User',
      referenceId: randomUUID(),
      templateData,
    });
  }

  sendWelcome(userId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'WELCOME',
      referenceType: 'User',
      referenceId: userId,
      templateData,
    });
  }

  sendOrderConfirmation(userId: string, orderId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'ORDER_CONFIRMATION',
      referenceType: 'Order',
      referenceId: orderId,
      templateData: { ...templateData, orderId },
    });
  }

  sendVendorNewOrder(vendorUserId: string, subOrderId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId: vendorUserId,
      type: 'VENDOR_NEW_ORDER',
      referenceType: 'SubOrder',
      referenceId: subOrderId,
      templateData,
    });
  }

  sendPaymentReceipt(userId: string, orderId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'PAYMENT_RECEIPT',
      referenceType: 'Order',
      referenceId: orderId,
      templateData: { ...templateData, orderId },
    });
  }

  sendPaymentFailed(userId: string, orderId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'PAYMENT_FAILED',
      referenceType: 'Order',
      referenceId: `${orderId}:failed:${todayBucket()}`,
      templateData: { ...templateData, orderId },
    });
  }

  sendSubOrderShipped(userId: string, subOrderId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'SUBORDER_SHIPPED',
      referenceType: 'SubOrder',
      referenceId: subOrderId,
      templateData,
    });
  }

  sendSubOrderDelivered(userId: string, subOrderId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'SUBORDER_DELIVERED',
      referenceType: 'SubOrder',
      referenceId: subOrderId,
      templateData,
    });
  }

  sendReviewRequest(userId: string, subOrderId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'REVIEW_REQUEST',
      referenceType: 'SubOrder',
      referenceId: subOrderId,
      templateData,
      urgency: 'marketing',
    });
  }

  sendOrderCancelled(userId: string, orderId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'ORDER_CANCELLED',
      referenceType: 'Order',
      referenceId: orderId,
      templateData: { ...templateData, orderId },
    });
  }

  sendOrderReturned(userId: string, returnId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'ORDER_RETURNED',
      referenceType: 'ReturnRequest',
      referenceId: returnId,
      templateData,
    });
  }

  sendRefundProcessed(
    userId: string,
    referenceId: string,
    templateData: EmailTemplateData = {},
    referenceType = 'ReturnRequest',
  ) {
    return this.enqueue({
      userId,
      type: 'REFUND_PROCESSED',
      referenceType,
      referenceId,
      templateData,
    });
  }

  sendVendorApplicationReceived(userId: string, vendorId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'VENDOR_APPLICATION_RECEIVED',
      referenceType: 'Vendor',
      referenceId: vendorId,
      templateData,
    });
  }

  sendAdminNewVendorPending(adminUserId: string, vendorId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId: adminUserId,
      type: 'ADMIN_NEW_VENDOR_PENDING',
      referenceType: 'Vendor',
      referenceId: `${vendorId}:${adminUserId}`,
      templateData,
    });
  }

  sendVendorApproved(userId: string, vendorId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'VENDOR_APPROVED',
      referenceType: 'Vendor',
      referenceId: vendorId,
      templateData,
    });
  }

  sendVendorRejected(userId: string, vendorId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'VENDOR_REJECTED',
      referenceType: 'Vendor',
      referenceId: vendorId,
      templateData,
    });
  }

  sendVendorSuspended(userId: string, vendorId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'VENDOR_SUSPENDED',
      referenceType: 'Vendor',
      referenceId: `${vendorId}:${todayBucket()}`,
      templateData,
    });
  }

  sendProductApproved(userId: string, productId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'PRODUCT_APPROVED',
      referenceType: 'Product',
      referenceId: productId,
      templateData,
    });
  }

  sendProductRejected(userId: string, productId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'PRODUCT_REJECTED',
      referenceType: 'Product',
      referenceId: productId,
      templateData,
    });
  }

  sendKycDocumentRejected(userId: string, documentId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'KYC_DOCUMENT_REJECTED',
      referenceType: 'VendorDocument',
      // Unique per rejection so a later reject of the same document still notifies.
      referenceId: `${documentId}-reject-${Date.now()}`,
      templateData,
    });
  }

  sendLowStockAlert(userId: string, variantId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'LOW_STOCK_ALERT',
      referenceType: 'ProductVariant',
      referenceId: `${variantId}:${todayBucket()}`,
      templateData,
    });
  }

  sendPayoutProcessed(userId: string, payoutId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'PAYOUT_PROCESSED',
      referenceType: 'Payout',
      referenceId: `${payoutId}:${userId}`,
      templateData,
    });
  }

  sendPayoutFailed(userId: string, payoutId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'PAYOUT_FAILED',
      referenceType: 'Payout',
      referenceId: `${payoutId}:${userId}`,
      templateData,
    });
  }

  sendReportExportReady(userId: string, exportId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'REPORT_EXPORT_READY',
      referenceType: 'ReportExportLog',
      referenceId: exportId,
      templateData: { ...templateData, exportId },
    });
  }

  sendAbandonedCart(userId: string, cartId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'ABANDONED_CART',
      referenceType: 'Cart',
      referenceId: `${cartId}:${todayBucket()}`,
      templateData,
      urgency: 'marketing',
    });
  }

  sendPriceDropAlert(userId: string, productId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'PRICE_DROP_ALERT',
      referenceType: 'Product',
      referenceId: `${productId}:${todayBucket()}`,
      templateData,
      urgency: 'marketing',
    });
  }

  sendBackInStock(userId: string, productId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'BACK_IN_STOCK',
      referenceType: 'Product',
      referenceId: `${productId}:${todayBucket()}`,
      templateData,
      urgency: 'marketing',
    });
  }

  sendCouponUsageLimit(userId: string, couponId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'COUPON_USAGE_LIMIT',
      referenceType: 'Coupon',
      referenceId: couponId,
      templateData,
    });
  }

  sendCouponExpiring(userId: string, couponId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'COUPON_EXPIRING',
      referenceType: 'Coupon',
      referenceId: couponId,
      templateData,
    });
  }

  sendCouponOfferExpiring(userId: string, couponId: string, templateData: EmailTemplateData = {}) {
    return this.enqueue({
      userId,
      type: 'COUPON_OFFER_EXPIRING',
      referenceType: 'Coupon',
      referenceId: `${couponId}:${userId}`,
      templateData,
      urgency: 'marketing',
    });
  }
}

export const notificationsService = new NotificationsService();
