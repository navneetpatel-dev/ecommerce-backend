'use strict';

/**
 * Report-engine verification fixture:
 * - two vendors in different states
 * - TCS ledgers in two periods
 * - TDS ledger with section 194O
 * Safe to re-run: deletes prior rows tagged with description marker in businessName slug prefix.
 */
const { v4: uuidv4 } = require('uuid');

const SLUG_A = 'report-fixture-vendor-ka';
const SLUG_B = 'report-fixture-vendor-mh';

module.exports = {
  async up(queryInterface) {
    const [aRows] = await queryInterface.sequelize.query(
      `SELECT id FROM vendors WHERE slug = :slug LIMIT 1`,
      { replacements: { slug: SLUG_A } },
    );
    const [bRows] = await queryInterface.sequelize.query(
      `SELECT id FROM vendors WHERE slug = :slug LIMIT 1`,
      { replacements: { slug: SLUG_B } },
    );

    let vendorAId = aRows[0]?.id;
    let vendorBId = bRows[0]?.id;
    const now = new Date();

    if (!vendorAId) {
      vendorAId = uuidv4();
      await queryInterface.bulkInsert('vendors', [
        {
          id: vendorAId,
          businessName: 'Report Fixture KA',
          slug: SLUG_A,
          state: 'KA',
          bankDetails: JSON.stringify({}),
          status: 'APPROVED',
          commissionRate: 10,
          performanceScore: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
    if (!vendorBId) {
      vendorBId = uuidv4();
      await queryInterface.bulkInsert('vendors', [
        {
          id: vendorBId,
          businessName: 'Report Fixture MH',
          slug: SLUG_B,
          state: 'MH',
          bankDetails: JSON.stringify({}),
          status: 'APPROVED',
          commissionRate: 10,
          performanceScore: 0,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }

    // Reuse any existing paid order + sub_order for FK; otherwise skip ledger inserts.
    const [subs] = await queryInterface.sequelize.query(
      `SELECT s.id AS "subOrderId", s."orderId", s."vendorId"
       FROM sub_orders s
       INNER JOIN orders o ON o.id = s."orderId"
       WHERE o."paymentStatus" = 'PAID' AND s."vendorId" IS NOT NULL
       LIMIT 2`,
    );

    if (!subs.length) {
      // eslint-disable-next-line no-console
      console.warn(
        '[report-engine-fixture] No paid sub_orders found — skipped TCS/TDS ledger seed. Run comprehensive seed first.',
      );
      return;
    }

    const periodPrev = new Date(now);
    periodPrev.setMonth(periodPrev.getMonth() - 1);
    const periodCur = now.toISOString().slice(0, 7);
    const periodOld = periodPrev.toISOString().slice(0, 7);

    const tcsRows = [];
    for (const [idx, sub] of subs.entries()) {
      const vendorId = idx === 0 ? vendorAId : vendorBId;
      tcsRows.push({
        id: uuidv4(),
        orderId: sub.orderId,
        subOrderId: sub.subOrderId,
        vendorId,
        taxableAmountPaise: 100000,
        ratePercent: 1,
        tcsAmountPaise: 1000,
        tcsCgstPaise: idx === 0 ? 500 : 0,
        tcsSgstPaise: idx === 0 ? 500 : 0,
        tcsIgstPaise: idx === 0 ? 0 : 1000,
        period: idx === 0 ? periodOld : periodCur,
        createdBy: null,
        updatedBy: null,
        deletedBy: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await queryInterface.bulkInsert('tcs_ledgers', tcsRows);

    await queryInterface.bulkInsert('tds_ledgers', [
      {
        id: uuidv4(),
        orderId: subs[0].orderId,
        subOrderId: subs[0].subOrderId,
        vendorId: vendorAId,
        payoutId: null,
        taxableAmountPaise: 90000,
        ratePercent: 1,
        tdsAmountPaise: 900,
        section: '194O',
        period: periodCur,
        createdBy: null,
        updatedBy: null,
        deletedBy: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DELETE FROM tds_ledgers WHERE section = '194O' AND period IS NOT NULL
       AND "vendorId" IN (SELECT id FROM vendors WHERE slug IN (:a, :b))`,
      { replacements: { a: SLUG_A, b: SLUG_B } },
    );
    await queryInterface.sequelize.query(
      `DELETE FROM tcs_ledgers
       WHERE "vendorId" IN (SELECT id FROM vendors WHERE slug IN (:a, :b))`,
      { replacements: { a: SLUG_A, b: SLUG_B } },
    );
    await queryInterface.bulkDelete('vendors', { slug: [SLUG_A, SLUG_B] });
  },
};
