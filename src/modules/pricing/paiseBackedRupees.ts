import { DataTypes, type Model, type ModelAttributeColumnOptions } from 'sequelize';
import { toPaise } from './money';

/**
 * A rupee attribute stored only as its paise column.
 *
 * sub_orders, order_items and commission_ledgers keep money in `*Paise` BIGINT columns
 * alone (migration 20260925000005 dropped the rupee DECIMAL twins). The rupee names
 * stay on the models so services, mappers and API responses keep working:
 *
 * - Reading returns the "1234.50" string Postgres returned for the old DECIMAL(10, 2)
 *   column, so response shapes and every `Number(row.x)` reader are unchanged.
 * - Writing converts to paise, so a caller that still sets rupees cannot drift from
 *   the stored value. New code writes the paise attribute directly.
 * - Selecting the rupee name in `attributes` loads its paise column automatically.
 */
export function paiseBackedRupees(paiseAttribute: string): ModelAttributeColumnOptions<Model> {
  return {
    type: DataTypes.VIRTUAL(DataTypes.DECIMAL(10, 2), [paiseAttribute]),
    get(this: Model) {
      const paise = this.getDataValue(paiseAttribute as never) as unknown;
      if (paise === undefined || paise === null) return paise;
      return (Number(paise) / 100).toFixed(2);
    },
    set(this: Model, value: unknown) {
      if (value === undefined || value === null) {
        this.setDataValue(paiseAttribute as never, value as never);
        return;
      }
      const rupees = Number(value);
      if (!Number.isFinite(rupees)) {
        throw new TypeError(`${paiseAttribute}: ${String(value)} is not a rupee amount`);
      }
      this.setDataValue(paiseAttribute as never, toPaise(rupees) as never);
    },
  };
}
