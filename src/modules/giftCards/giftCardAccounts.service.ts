import { Op } from 'sequelize';
import { GiftCard } from '@database/models/giftCard.model';
import { User } from '@database/models/user.model';
import { AppError } from '@core/errors/AppError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { GIFT_CARD_STATUS } from '@core/constants/statuses';
import { sendGiftCardPurchasedEmail } from './giftCardEmail';
import { buildPaginationMeta, type PaginationMeta } from '@core/http/pagination';
import { GIFT_CARD_PERSON_ATTRIBUTES, effectiveGiftCardStatus, toGiftCardView, type GiftCardView } from './giftCardViews';

const LIST_LIMIT = 100;

/** A customer's gift cards: the ones they bought (paid) and the ones they redeemed. */
export const giftCardAccountsService = {
  /** Cards bought and cards redeemed, each paged on its own (they were cut off at 100). */
  async mine(
    userId: string,
    query: { purchasedPage: number; redeemedPage: number; limit: number } = { purchasedPage: 1, redeemedPage: 1, limit: LIST_LIMIT },
  ): Promise<{ purchased: GiftCardView[]; redeemed: GiftCardView[]; purchasedPagination: PaginationMeta; redeemedPagination: PaginationMeta }> {
    const [purchased, redeemed] = await Promise.all([
      GiftCard.findAndCountAll({
        where: { purchaserId: userId, status: { [Op.notIn]: [GIFT_CARD_STATUS.PENDING, GIFT_CARD_STATUS.FAILED] } },
        include: [{ model: User, as: 'redeemer', attributes: GIFT_CARD_PERSON_ATTRIBUTES, required: false }],
        order: [['createdAt', 'DESC'], ['id', 'ASC']],
        limit: query.limit,
        offset: (query.purchasedPage - 1) * query.limit,
      }),
      GiftCard.findAndCountAll({
        where: { redeemedByUserId: userId },
        include: [{ model: User, as: 'purchaser', attributes: GIFT_CARD_PERSON_ATTRIBUTES, required: false }],
        order: [['redeemedAt', 'DESC'], ['id', 'ASC']],
        limit: query.limit,
        offset: (query.redeemedPage - 1) * query.limit,
      }),
    ]);
    return {
      purchased: purchased.rows.map(toGiftCardView),
      redeemed: redeemed.rows.map(toGiftCardView),
      purchasedPagination: buildPaginationMeta(purchased.count, query.purchasedPage, query.limit),
      redeemedPagination: buildPaginationMeta(redeemed.count, query.redeemedPage, query.limit),
    };
  },

  /** Emails the card to its recipient again — the buyer's own, still-usable cards only. */
  async resend(userId: string, giftCardId: string): Promise<{ sent: true }> {
    const card = await GiftCard.findByPk(giftCardId);
    if (!card || card.purchaserId !== userId) throw new NotFoundError('Gift card');
    if (effectiveGiftCardStatus(card) !== GIFT_CARD_STATUS.ACTIVE) {
      throw new AppError(ERROR_MESSAGES.GIFT_CARD_NOT_RESENDABLE, 409, ERROR_CODES.GIFT_CARD_NOT_RESENDABLE);
    }
    if (!(await sendGiftCardPurchasedEmail(card))) {
      throw new AppError(ERROR_MESSAGES.GIFT_CARD_EMAIL_FAILED, 502, ERROR_CODES.GIFT_CARD_EMAIL_FAILED);
    }
    return { sent: true };
  },
};
