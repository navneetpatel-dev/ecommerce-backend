import { Op } from 'sequelize';
import { EmailSuppression } from '@database/models/emailSuppression.model';

/** A bounced address is skipped for this long, then tried again (a mailbox can be fixed or re-created). */
export const SUPPRESSION_DAYS = 30;

const normalise = (email: string) => email.trim().toLowerCase();

export async function isAddressSuppressed(email: string): Promise<boolean> {
  const row = await EmailSuppression.findOne({ where: { email: normalise(email), expiresAt: { [Op.gt]: new Date() } }, attributes: ['id'] });
  return row != null;
}

export async function suppressAddress(email: string, reason: string): Promise<void> {
  const expiresAt = new Date(Date.now() + SUPPRESSION_DAYS * 24 * 60 * 60 * 1000);
  const existing = await EmailSuppression.findOne({ where: { email: normalise(email) } });
  if (existing) await existing.update({ reason: reason.slice(0, 500), expiresAt });
  else await EmailSuppression.create({ email: normalise(email), reason: reason.slice(0, 500), expiresAt });
}

export async function clearSuppression(email: string): Promise<void> {
  await EmailSuppression.destroy({ where: { email: normalise(email) } });
}
