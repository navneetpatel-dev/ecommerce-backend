'use strict';

/**
 * Every vendor gets a stored, unique invoice prefix.
 *
 * Invoice, credit and debit note numbers are `{prefix}/{FY}/{serial}` with a serial per
 * vendor, and the prefix was derived on each issue from the first and last four letters
 * of the slug: "shop-alpha-gear" and "shop-beta-gear" both gave SHOPGEAR, so the second
 * vendor's first invoice repeated the first's number and its dispatch failed on the
 * unique invoice number (GSTR-1 also merged the two).
 *
 * The prefix each vendor has been using is stored as is. Where two share one, the vendor
 * that already issued documents under it keeps it (else the oldest), and the others get
 * a short suffix from their id. A unique index keeps it that way.
 */

const INDEX = 'vendors_invoice_prefix_unique';

/** The prefix pricing/vendorInvoiceSequence derived before this migration. */
function derivedPrefix(slug, vendorId) {
  const alnum = String(slug || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (alnum.length >= 4) {
    const head = alnum.slice(0, 4);
    const tail = alnum.slice(-4);
    return (tail && tail !== head ? `${head}${tail}` : head).slice(0, 16);
  }
  return String(vendorId).replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const query = (sql, replacements) =>
        queryInterface.sequelize.query(sql, { transaction, replacements, type: 'SELECT' });

      const vendors = await query(
        `SELECT id, slug, "invoicePrefix", "createdAt" FROM vendors ORDER BY "createdAt", id`,
      );
      const used = new Set(vendors.filter((v) => v.invoicePrefix).map((v) => v.invoicePrefix));
      const groups = new Map();
      for (const vendor of vendors.filter((v) => !v.invoicePrefix)) {
        const prefix = derivedPrefix(vendor.slug, vendor.id);
        if (!groups.has(prefix)) groups.set(prefix, []);
        groups.get(prefix).push(vendor);
      }

      const assigned = [];
      for (const [prefix, members] of groups) {
        let keeper = members[0];
        if (members.length > 1) {
          for (const vendor of members) {
            const [issued] = await query(
              `SELECT 1 AS found FROM sub_orders WHERE "vendorId" = :id AND "taxInvoiceNumber" LIKE :like
               UNION ALL SELECT 1 FROM credit_notes WHERE "vendorId" = :id AND number LIKE :like
               UNION ALL SELECT 1 FROM debit_notes WHERE "vendorId" = :id AND number LIKE :like
               LIMIT 1`,
              { id: vendor.id, like: `${prefix}/%` },
            );
            if (issued) {
              keeper = vendor;
              break;
            }
          }
        }
        for (const vendor of members) {
          let value = prefix;
          if (vendor !== keeper || used.has(prefix)) {
            const hex = String(vendor.id).replace(/-/g, '').toUpperCase();
            value = `${prefix.slice(0, 12)}${hex.slice(0, 4)}`;
            if (used.has(value)) value = `${prefix.slice(0, 8)}${hex.slice(0, 8)}`;
          }
          used.add(value);
          assigned.push({ id: vendor.id, value });
        }
      }

      for (const { id, value } of assigned) {
        await queryInterface.sequelize.query(
          `UPDATE vendors SET "invoicePrefix" = :value WHERE id = :id`,
          { transaction, replacements: { id, value } },
        );
      }
      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX "${INDEX}" ON vendors ("invoicePrefix") WHERE "invoicePrefix" IS NOT NULL`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    // The stored prefixes stay: they are what the vendors' documents were numbered with.
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "${INDEX}"`);
  },
};
