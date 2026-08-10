import { z } from 'zod';
import { Op, type WhereOptions } from 'sequelize';
import { ValidationError } from '@core/errors/ValidationError';

export const KEYSET_DEFAULT_LIMIT = 20;
export const KEYSET_MAX_LIMIT = 50;

export type KeysetCursor = {
  createdAt: string;
  id: string;
};

export type KeysetDirection = 'older' | 'newer';

export type KeysetPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export const keysetQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(KEYSET_MAX_LIMIT)
    .default(KEYSET_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
  direction: z.enum(['older', 'newer']).default('older'),
});

export type KeysetQuery = z.infer<typeof keysetQuerySchema>;

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined | null): KeysetCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as KeysetCursor;
    if (!parsed?.createdAt || !parsed?.id) {
      throw new Error('invalid cursor shape');
    }
    return { createdAt: String(parsed.createdAt), id: String(parsed.id) };
  } catch {
    throw new ValidationError({ cursor: ['Invalid cursor'] });
  }
}

/**
 * Keyset WHERE for (createdAt, id) ordering.
 * `older` = next page when ORDER BY createdAt DESC, id DESC
 * `newer` = reverse direction (createdAt ASC, id ASC)
 */
export function buildKeysetWhere(
  cursor: KeysetCursor | null,
  direction: KeysetDirection = 'older',
): WhereOptions | undefined {
  if (!cursor) return undefined;
  const createdAt = new Date(cursor.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new ValidationError({ cursor: ['Invalid cursor'] });
  }

  if (direction === 'older') {
    return {
      [Op.or]: [
        { createdAt: { [Op.lt]: createdAt } },
        { createdAt, id: { [Op.lt]: cursor.id } },
      ],
    };
  }

  return {
    [Op.or]: [
      { createdAt: { [Op.gt]: createdAt } },
      { createdAt, id: { [Op.gt]: cursor.id } },
    ],
  };
}

export function keysetOrder(direction: KeysetDirection = 'older'): Array<[string, 'ASC' | 'DESC']> {
  if (direction === 'newer') {
    return [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ];
  }
  return [
    ['createdAt', 'DESC'],
    ['id', 'DESC'],
  ];
}

export function buildKeysetPage<T extends { createdAt: Date | string; id: string }>(
  rows: T[],
  limit: number,
): KeysetPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          createdAt: new Date(last.createdAt).toISOString(),
          id: last.id,
        })
      : null;
  return { items, nextCursor };
}
