import type { GiftCard } from '@database/models/giftCard.model';
import { GIFT_CARD_STATUS } from '@core/constants/statuses';
import { roundMoney } from '@modules/pricing/money';

type Person = { id: string; name: string | null; email: string } | null;

export type GiftCardView = {
  id: string;
  code: string;
  amount: number;
  /** ACTIVE past its expiry reads EXPIRED (the row is marked when someone tries it). */
  status: string;
  recipientEmail: string;
  recipientName: string | null;
  message: string | null;
  purchasedAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
  purchaser?: Person;
  redeemer?: Person;
};

export function effectiveGiftCardStatus(card: Pick<GiftCard, 'status' | 'expiresAt'>, now = Date.now()): string {
  return card.status === GIFT_CARD_STATUS.ACTIVE && card.expiresAt.getTime() < now ? GIFT_CARD_STATUS.EXPIRED : card.status;
}

function person(value: unknown): Person {
  if (!value || typeof value !== 'object') return null;
  const row = value as { id: string; name: string | null; email: string };
  return { id: row.id, name: row.name ?? null, email: row.email };
}

export function toGiftCardView(card: GiftCard): GiftCardView {
  const withPeople = card as GiftCard & { purchaser?: unknown; redeemer?: unknown };
  return {
    id: card.id,
    code: card.code,
    amount: roundMoney(card.amount),
    status: effectiveGiftCardStatus(card),
    recipientEmail: card.recipientEmail,
    recipientName: card.recipientName,
    message: card.message,
    purchasedAt: card.paidAt ?? card.createdAt,
    expiresAt: card.expiresAt,
    redeemedAt: card.redeemedAt,
    ...(withPeople.purchaser !== undefined ? { purchaser: person(withPeople.purchaser) } : {}),
    ...(withPeople.redeemer !== undefined ? { redeemer: person(withPeople.redeemer) } : {}),
  };
}

export const GIFT_CARD_PERSON_ATTRIBUTES = ['id', 'name', 'email'];
