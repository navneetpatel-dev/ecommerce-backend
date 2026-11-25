import { Op } from 'sequelize';
import { EmailSuppression } from '@database/models/emailSuppression.model';
import { User } from '@database/models/user.model';

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

export async function listSuppressions(opts: {
  search?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{
  items: Array<{ id: string; email: string; reason: string; expiresAt: Date; updatedAt: Date }>;
  total: number;
  page: number;
  hasMore: boolean;
}> {
  const page = Math.max(opts.page ?? 1, 1);
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const search = opts.search?.trim().toLowerCase();
  const where: Record<string, unknown> = {};
  if (search) where.email = { [Op.iLike]: `%${search}%` };

  const { count, rows } = await EmailSuppression.findAndCountAll({
    where,
    attributes: ['id', 'email', 'reason', 'expiresAt', 'updatedAt'],
    order: [['updatedAt', 'DESC']],
    limit,
    offset: (page - 1) * limit,
  });

  return {
    items: rows.map((r) => ({
      id: r.id,
      email: r.email,
      reason: r.reason,
      expiresAt: r.expiresAt,
      updatedAt: r.updatedAt,
    })),
    total: count,
    page,
    hasMore: page * limit < count,
  };
}

export async function unsuppressEmail(email: string): Promise<{ cleared: boolean }> {
  const clean = normalise(email);
  await clearSuppression(clean);
  await User.update({ emailSuppressed: false }, { where: { email: clean } });
  return { cleared: true };
}
