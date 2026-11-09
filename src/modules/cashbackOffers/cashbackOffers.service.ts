import { Op, type Transaction } from 'sequelize';
import { CashbackOffer } from '@database/models/cashbackOffer.model';
import { Category } from '@database/models/category.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { logAudit } from '@modules/audit/audit.service';
import { roundMoney } from '@modules/pricing/money';
import type { LiveCashbackOffer } from './cashbackOfferEngine';
import type {
  CashbackOfferListQuery,
  CreateCashbackOfferRequest,
  UpdateCashbackOfferRequest,
} from './cashbackOffers.dto';
import { CreateCashbackOfferSchema } from './cashbackOffers.dto';

export type CashbackOfferState = 'LIVE' | 'SCHEDULED' | 'ENDED' | 'OFF';

export type CashbackOfferView = {
  id: string;
  name: string;
  percent: number;
  maxCashback: number | null;
  minOrderValue: number;
  categoryIds: string[];
  paymentMethods: string[];
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
  state: CashbackOfferState;
};

function stateOf(offer: CashbackOffer, now = new Date()): CashbackOfferState {
  if (!offer.isActive) return 'OFF';
  if (offer.endsAt && offer.endsAt <= now) return 'ENDED';
  if (offer.startsAt > now) return 'SCHEDULED';
  return 'LIVE';
}

function toView(offer: CashbackOffer, categoryIds: string[] = offer.categoryIds ?? []): CashbackOfferView {
  return {
    id: offer.id,
    name: offer.name,
    percent: Number(offer.percent),
    maxCashback: offer.maxCashback == null ? null : roundMoney(offer.maxCashback),
    minOrderValue: roundMoney(offer.minOrderValue ?? 0),
    categoryIds,
    paymentMethods: offer.paymentMethods ?? [],
    startsAt: offer.startsAt,
    endsAt: offer.endsAt,
    isActive: offer.isActive,
    state: stateOf(offer),
  };
}

/** Each category id mapped to itself plus every category below it. */
async function expandCategories(ids: readonly string[], transaction?: Transaction): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const all = await Category.findAll({ attributes: ['id', 'parentId'], transaction, paranoid: false });
  const children = new Map<string, string[]>();
  for (const row of all) {
    if (!row.parentId) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
  }
  const out = new Set<string>();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}

async function assertCategoriesExist(ids: readonly string[] | undefined) {
  if (!ids?.length) return;
  const found = await Category.count({ where: { id: { [Op.in]: [...new Set(ids)] } } });
  if (found !== new Set(ids).size) throw new ValidationError(ERROR_MESSAGES.CASHBACK_OFFER_CATEGORY_INVALID);
}

async function liveRows(transaction?: Transaction) {
  const now = new Date();
  return CashbackOffer.findAll({
    where: {
      isActive: true,
      startsAt: { [Op.lte]: now },
      [Op.or]: [{ endsAt: null }, { endsAt: { [Op.gt]: now } }],
    },
    order: [['createdAt', 'ASC']],
    transaction,
  });
}

export const cashbackOffersService = {
  async list(query: CashbackOfferListQuery) {
    const { rows, count } = await CashbackOffer.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset: paginationOffset(query.page, query.limit),
    });
    return { items: rows.map((row) => toView(row)), pagination: buildPaginationMeta(count, query.page, query.limit) };
  },

  async create(actorId: string, dto: CreateCashbackOfferRequest) {
    await assertCategoriesExist(dto.categoryIds);
    const offer = await CashbackOffer.create({
      ...dto,
      maxCashback: dto.maxCashback ?? null,
      endsAt: dto.endsAt ?? null,
      createdBy: actorId,
      updatedBy: actorId,
    });
    await logAudit({ actorId, action: 'CASHBACK_OFFER_CREATED', entityType: 'CashbackOffer', entityId: offer.id, metadata: { ...dto } });
    return toView(offer);
  },

  async update(actorId: string, id: string, dto: UpdateCashbackOfferRequest) {
    const offer = await CashbackOffer.findByPk(id);
    if (!offer) throw new NotFoundError('Cashback offer');
    await assertCategoriesExist(dto.categoryIds);
    // Re-check the offer as it will be stored (e.g. a new end date against the stored start).
    const merged = CreateCashbackOfferSchema.safeParse({ ...toView(offer), ...dto });
    if (!merged.success) throw new ValidationError(merged.error.issues[0]?.message ?? ERROR_MESSAGES.CASHBACK_OFFER_INVALID);
    await offer.update({ ...dto, updatedBy: actorId });
    await logAudit({ actorId, action: 'CASHBACK_OFFER_UPDATED', entityType: 'CashbackOffer', entityId: offer.id, metadata: { ...dto } });
    return toView(offer);
  },

  /** Soft delete: orders that got the offer keep pointing at it. */
  async remove(actorId: string, id: string) {
    const offer = await CashbackOffer.findByPk(id);
    if (!offer) throw new NotFoundError('Cashback offer');
    await offer.update({ isActive: false, updatedBy: actorId });
    await offer.destroy();
    await logAudit({ actorId, action: 'CASHBACK_OFFER_DELETED', entityType: 'CashbackOffer', entityId: offer.id, metadata: { name: offer.name } });
  },

  /** Live offers for the checkout engine, with categories expanded to their sub-categories. */
  async live(transaction?: Transaction): Promise<LiveCashbackOffer[]> {
    const rows = await liveRows(transaction);
    return Promise.all(
      rows.map(async (row) => {
        const view = toView(row);
        return { ...view, categoryIds: await expandCategories(view.categoryIds, transaction) };
      }),
    );
  },

  /** Live offers for badges: `categoryIds` already lists every sub-category, so a product matches by its own category. */
  async publicLive(): Promise<CashbackOfferView[]> {
    const rows = await liveRows();
    return Promise.all(rows.map(async (row) => toView(row, [...(await expandCategories(row.categoryIds ?? []))])));
  },
};
