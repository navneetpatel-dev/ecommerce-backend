/** A model instance as a plain object; an object that is already plain passes through. */
export function toPlain<T = Record<string, unknown>>(row: unknown): T {
  const model = row as { get?: (options: { plain: true }) => unknown };
  return (typeof model?.get === 'function' ? model.get({ plain: true }) : row) as T;
}
