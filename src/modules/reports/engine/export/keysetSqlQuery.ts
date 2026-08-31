import { sequelize } from '@database/models';
import type { ReportQueryResult } from '../types';

export type KeysetOrderCol = {
  column: string;
  direction: 'ASC' | 'DESC';
};

export type KeysetCursor = {
  values: unknown[];
};

function quoteIdent(column: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
    throw new Error(`Invalid keyset column: ${column}`);
  }
  return `"${column}"`;
}

/** Builds `(a < va) OR (a = va AND b > vb) …` matching mixed ASC/DESC order. */
export function buildKeysetPredicate(
  order: KeysetOrderCol[],
  cursor: KeysetCursor,
  paramPrefix = 'ks',
): { sql: string; replacements: Record<string, unknown> } {
  if (order.length === 0) throw new Error('keyset order is required');
  if (cursor.values.length !== order.length) {
    throw new Error('keyset cursor length must match order columns');
  }
  const replacements: Record<string, unknown> = {};
  const parts: string[] = [];
  for (let i = 0; i < order.length; i += 1) {
    const eqs = order.slice(0, i).map((col, j) => `${quoteIdent(col.column)} = :${paramPrefix}_${j}`);
    const col = order[i]!;
    const op = col.direction === 'DESC' ? '<' : '>';
    const cmp = `${quoteIdent(col.column)} ${op} :${paramPrefix}_${i}`;
    parts.push(`(${[...eqs, cmp].join(' AND ')})`);
    replacements[`${paramPrefix}_${i}`] = cursor.values[i];
  }
  return { sql: `(${parts.join(' OR ')})`, replacements };
}

export function cursorFromRow(
  row: Record<string, unknown>,
  order: KeysetOrderCol[],
): KeysetCursor {
  return { values: order.map((col) => row[col.column]) };
}

/**
 * Keyset page over a SELECT that already aliases sort columns.
 * Does not wrap the inner query in ROW_NUMBER / OFFSET.
 */
export async function keysetSqlQuery<T extends Record<string, unknown>>(opts: {
  selectSql: string;
  order: KeysetOrderCol[];
  replacements: Record<string, unknown>;
  limit: number;
  cursor?: KeysetCursor | null;
  mapRow: (row: Record<string, unknown>) => T;
}): Promise<{ rows: T[]; nextCursor: KeysetCursor | null; raw: Array<Record<string, unknown>> }> {
  const orderSql = opts.order
    .map((col) => `${quoteIdent(col.column)} ${col.direction}`)
    .join(', ');
  let whereSql = '';
  const replacements: Record<string, unknown> = {
    ...opts.replacements,
    _limit: opts.limit,
  };
  if (opts.cursor) {
    const pred = buildKeysetPredicate(opts.order, opts.cursor);
    whereSql = `WHERE ${pred.sql}`;
    Object.assign(replacements, pred.replacements);
  }
  const sql = `
    SELECT * FROM (${opts.selectSql}) AS _ks
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT :_limit
  `;
  const [rows] = await sequelize.query(sql, { replacements });
  const raw = rows as Array<Record<string, unknown>>;
  const mapped = raw.map(opts.mapRow);
  if (mapped.length === 0) return { rows: [], nextCursor: null, raw: [] };
  const last = raw[raw.length - 1]!;
  return {
    rows: mapped,
    nextCursor: mapped.length < opts.limit ? null : cursorFromRow(last, opts.order),
    raw,
  };
}

export function attachKnownTotal(result: ReportQueryResult, knownTotal: number): ReportQueryResult {
  return { ...result, total: knownTotal };
}
