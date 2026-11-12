import { Op } from 'sequelize';
import { WalletLedger } from '@database/models/walletLedger.model';
import { GiftCard } from '@database/models/giftCard.model';
import { SupportTicket } from '@database/models/supportTicket.model';
import { BugReport } from '@database/models/bugReport.model';
import { ProductQuestion } from '@database/models/productQuestion.model';
import { StockAlert } from '@database/models/stockAlert.model';

/** Fields that are secrets or internal, never part of a shopper's own data export. */
const GIFT_CARD_HIDDEN = ['code', 'razorpayOrderId', 'razorpayPaymentId'];

/**
 * The parts of "Download my data" the export left out (B-51): wallet history,
 * gift cards sent and received, support tickets with their messages, bug
 * reports, product questions and back-in-stock alerts.
 */
export async function accountExportExtras(userId: string, email: string) {
  const [walletHistory, giftCardsSent, giftCardsReceived, supportTickets, bugReports, productQuestions, stockAlerts] =
    await Promise.all([
      WalletLedger.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
      GiftCard.findAll({ where: { purchaserId: userId }, attributes: { exclude: GIFT_CARD_HIDDEN }, order: [['createdAt', 'DESC']] }),
      GiftCard.findAll({
        where: { [Op.or]: [{ redeemedByUserId: userId }, { recipientEmail: email }], purchaserId: { [Op.ne]: userId } },
        attributes: { exclude: GIFT_CARD_HIDDEN },
        order: [['createdAt', 'DESC']],
      }),
      SupportTicket.findAll({ where: { customerId: userId }, include: [{ association: 'messages' }], order: [['createdAt', 'DESC']] }),
      BugReport.findAll({ where: { reporterId: userId }, order: [['createdAt', 'DESC']] }),
      ProductQuestion.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
      StockAlert.findAll({ where: { userId }, order: [['createdAt', 'DESC']] }),
    ]);
  return { walletHistory, giftCardsSent, giftCardsReceived, supportTickets, bugReports, productQuestions, stockAlerts };
}
