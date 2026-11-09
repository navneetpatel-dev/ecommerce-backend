import { Op, QueryTypes, type WhereOptions } from 'sequelize';
import { sequelize } from '@database/models';
import { GiftCard } from '@database/models/giftCard.model';
import { User } from '@database/models/user.model';
import { AppError } from '@core/errors/AppError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { GIFT_CARD_STATUS } from '@core/constants/statuses';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { logAudit } from '@modules/audit/audit.service';
import { fromPaise } from '@modules/pricing/money';
import type { AdminGiftCardListQuery } from './giftCards.dto';
import { GIFT_CARD_PERSON_ATTRIBUTES, effectiveGiftCardStatus, toGiftCardView } from './giftCardViews';

export type GiftCardLiability = {
  /** Paid, unredeemed and unexpired: what customers can still turn into wallet points. */
  outstanding: number;
  outstandingCount: number;
  redeemed: number;
  expired: number;
  cancelled: number;
  issued: number;
};

/** Filters by the status the list shows, so an ACTIVE card past its expiry counts as EXPIRED. */
function statusWhere(status: AdminGiftCardListQuery['status']): WhereOptions {
  if (!status) return {};
  const now = new Date();
  if (status === GIFT_CARD_STATUS.ACTIVE) return { status, expiresAt: { [Op.gte]: now } };
  if (status === GIFT_CARD_STATUS.EXPIRED) {
    return {
      [Op.or]: [{ status }, { status: GIFT_CARD_STATUS.ACTIVE, expiresAt: { [Op.lt]: now } }],
    };
  }
  return { status };
}

function searchWhere(search: string | undefined): WhereOptions {
  if (!search) return {};
  const like = `%${search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  return {
    [Op.or]: [
      { code: { [Op.iLike]: like } },
      { recipientEmail: { [Op.iLike]: like } },
      { '$purchaser.email$': { [Op.iLike]: like } },
    ],
  };
}

export const giftCardsAdminService = {
  async list(query: AdminGiftCardListQuery) {
    const { rows, count } = await GiftCard.findAndCountAll({
      where: { [Op.and]: [statusWhere(query.status), searchWhere(query.search)] },
      include: [
        { model: User, as: 'purchaser', attributes: GIFT_CARD_PERSON_ATTRIBUTES, required: false },
        { model: User, as: 'redeemer', attributes: GIFT_CARD_PERSON_ATTRIBUTES, required: false },
      ],
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset: paginationOffset(query.page, query.limit),
      subQuery: false,
      distinct: true,
    });
    return { items: rows.map(toGiftCardView), pagination: buildPaginationMeta(count, query.page, query.limit) };
  },

  /** Amounts in paise from the DB, so the totals are exact. */
  async liability(): Promise<GiftCardLiability> {
    const [row] = await sequelize.query<Record<string, string | null>>(
      `SELECT
         COALESCE(SUM(ROUND(amount * 100)) FILTER (WHERE status = 'ACTIVE' AND "expiresAt" >= NOW()), 0) AS outstanding,
         COUNT(*) FILTER (WHERE status = 'ACTIVE' AND "expiresAt" >= NOW()) AS "outstandingCount",
         COALESCE(SUM(ROUND(amount * 100)) FILTER (WHERE status = 'REDEEMED'), 0) AS redeemed,
         COALESCE(SUM(ROUND(amount * 100)) FILTER (WHERE status = 'EXPIRED' OR (status = 'ACTIVE' AND "expiresAt" < NOW())), 0) AS expired,
         COALESCE(SUM(ROUND(amount * 100)) FILTER (WHERE status = 'CANCELLED'), 0) AS cancelled,
         COALESCE(SUM(ROUND(amount * 100)) FILTER (WHERE "paidAt" IS NOT NULL), 0) AS issued
       FROM gift_cards WHERE "deletedAt" IS NULL`,
      { type: QueryTypes.SELECT },
    );
    const paise = (key: string) => fromPaise(Number(row?.[key] ?? 0));
    return {
      outstanding: paise('outstanding'),
      outstandingCount: Number(row?.outstandingCount ?? 0),
      redeemed: paise('redeemed'),
      expired: paise('expired'),
      cancelled: paise('cancelled'),
      issued: paise('issued'),
    };
  },

  /** Stops a card from being redeemed (e.g. fraud). It does not refund the buyer. */
  async cancel(actorId: string, giftCardId: string, reason: string) {
    const card = await sequelize.transaction(async (transaction) => {
      const row = await GiftCard.findByPk(giftCardId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw new NotFoundError('Gift card');
      if (effectiveGiftCardStatus(row) !== GIFT_CARD_STATUS.ACTIVE) {
        throw new AppError(ERROR_MESSAGES.GIFT_CARD_NOT_CANCELLABLE, 409, ERROR_CODES.GIFT_CARD_NOT_CANCELLABLE);
      }
      await row.update({ status: GIFT_CARD_STATUS.CANCELLED, updatedBy: actorId }, { transaction });
      await logAudit({
        actorId,
        action: 'GIFT_CARD_CANCELLED',
        entityType: 'GiftCard',
        entityId: row.id,
        metadata: { code: row.code, amount: Number(row.amount), reason },
        transaction,
      });
      return row;
    });
    return toGiftCardView(card);
  },
};
