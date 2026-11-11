import { User } from '@database/models/user.model';

/** Recipient for a new address: what the shopper typed, else the account holder's name and phone. */
export async function recipientFor(
  userId: string,
  data: { recipientName?: string; recipientPhone?: string },
): Promise<{ recipientName: string | null; recipientPhone: string | null }> {
  if (data.recipientName && data.recipientPhone) {
    return { recipientName: data.recipientName, recipientPhone: data.recipientPhone };
  }
  const user = await User.findByPk(userId, { attributes: ['name', 'phone'] });
  return {
    recipientName: data.recipientName || user?.name || null,
    recipientPhone: data.recipientPhone || user?.phone || null,
  };
}
