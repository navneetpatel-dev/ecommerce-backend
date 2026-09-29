'use strict';

/**
 * Freeze the HSN code and GST rate on every tax invoice snapshot line written before
 * they were recorded, so GST reports and re-downloaded invoices read what was charged
 * instead of today's tax rules.
 *
 * - Rate: the order line's stored breakdown rate; for a fully returned line (whose
 *   breakdown was cleared) the rate implied by the snapshot's own tax over taxable,
 *   snapped to the nearest GST slab.
 * - HSN: the product's own code, else the nearest category rule up the tree, else the
 *   default rule (rules picked oldest first, then lowest rate — as taxService does).
 */

const GST_SLABS = [0, 0.1, 0.25, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
const RULE_ORDER = (a, b) =>
  new Date(a.createdAt) - new Date(b.createdAt) ||
  Number(a.gstPercentage) - Number(b.gstPercentage) ||
  String(a.id).localeCompare(String(b.id));

function impliedRate(line) {
  const taxable = Number(line.taxablePaise ?? 0);
  if (taxable <= 0) return 0;
  const tax = Number(line.cgstPaise ?? 0) + Number(line.sgstPaise ?? 0) + Number(line.igstPaise ?? 0);
  const raw = (tax / taxable) * 100;
  const nearest = GST_SLABS.reduce((best, slab) => (Math.abs(slab - raw) < Math.abs(best - raw) ? slab : best));
  return Math.abs(nearest - raw) <= 0.1 ? nearest : Math.round(raw * 100) / 100;
}

module.exports = {
  async up(queryInterface) {
    const q = (sql, replacements) =>
      queryInterface.sequelize.query(sql, { replacements, type: queryInterface.sequelize.QueryTypes.SELECT });

    const rules = await q(
      `SELECT id, "categoryId", "hsnCode", "gstPercentage", "createdAt" FROM tax_rules WHERE "deletedAt" IS NULL`,
    );
    const ruleByCategory = new Map();
    let defaultRule = null;
    for (const rule of [...rules].sort(RULE_ORDER)) {
      if (rule.categoryId == null) defaultRule = defaultRule ?? rule;
      else if (!ruleByCategory.has(rule.categoryId)) ruleByCategory.set(rule.categoryId, rule);
    }
    const categories = await q(`SELECT id, "parentId" FROM categories`);
    const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
    const hsnForCategory = (categoryId) => {
      let node = categoryId;
      for (let depth = 0; node && depth < 20; depth += 1) {
        const rule = ruleByCategory.get(node);
        if (rule) return rule.hsnCode ? String(rule.hsnCode).trim() || null : null;
        node = parentOf.get(node);
      }
      return defaultRule?.hsnCode ? String(defaultRule.hsnCode).trim() || null : null;
    };

    const subOrders = await q(
      `SELECT id, "taxInvoiceSnapshot" AS snapshot FROM sub_orders
        WHERE "taxInvoiceSnapshot" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements("taxInvoiceSnapshot"->'lines') l
             WHERE NOT (l ? 'gstPercentage') OR NOT (l ? 'hsnCode')
          )`,
    );
    let updated = 0;
    for (const sub of subOrders) {
      const snapshot = typeof sub.snapshot === 'string' ? JSON.parse(sub.snapshot) : sub.snapshot;
      const itemIds = snapshot.lines.map((line) => line.orderItemId);
      const items = itemIds.length
        ? await q(
            `SELECT oi.id, oi."taxBreakdown", p."hsnCode", p."categoryId"
               FROM order_items oi
               LEFT JOIN product_variants pv ON pv.id = oi."variantId"
               LEFT JOIN products p ON p.id = pv."productId"
              WHERE oi.id IN (:ids)`,
            { ids: itemIds },
          )
        : [];
      const itemById = new Map(items.map((item) => [item.id, item]));
      snapshot.lines = snapshot.lines.map((line) => {
        const item = itemById.get(line.orderItemId);
        const breakdown =
          typeof item?.taxBreakdown === 'string' ? JSON.parse(item.taxBreakdown) : item?.taxBreakdown;
        const storedRate = breakdown?.gstPercentage != null ? Number(breakdown.gstPercentage) : null;
        return {
          ...line,
          gstPercentage:
            line.gstPercentage ?? (Number.isFinite(storedRate) ? storedRate : impliedRate(line)),
          hsnCode:
            line.hsnCode !== undefined
              ? line.hsnCode
              : (item?.hsnCode ? String(item.hsnCode).trim() : '') || hsnForCategory(item?.categoryId) || null,
        };
      });
      await queryInterface.sequelize.query(
        `UPDATE sub_orders SET "taxInvoiceSnapshot" = :snapshot::jsonb WHERE id = :id`,
        { replacements: { id: sub.id, snapshot: JSON.stringify(snapshot) } },
      );
      updated += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`Froze HSN and GST rate on ${updated} invoice snapshots`);
  },

  async down() {
    // The added keys are harmless to older readers; nothing to undo.
  },
};
