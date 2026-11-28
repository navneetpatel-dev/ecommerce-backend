import type { CreationOptional, InferAttributes, Model } from 'sequelize';

/** Sequelize marks optional-on-create columns with a private brand; plain data has none. */
type Unbranded<T> = T extends unknown[]
  ? Array<T[number]>
  : T extends CreationOptional<infer Value>
    ? Value
    : T;

/** A model's columns as plain data, plus whatever relations the query included. */
export type PlainRow<M extends Model, Included = unknown> = {
  [Key in keyof InferAttributes<M>]: Unbranded<InferAttributes<M>[Key]>;
} & Included;

/** A model instance as a plain object; an object that is already plain passes through. */
export function toPlain<T = Record<string, unknown>>(row: unknown): T {
  const model = row as { get?: (options: { plain: true }) => unknown };
  return (typeof model?.get === 'function' ? model.get({ plain: true }) : row) as T;
}
