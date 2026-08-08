'use strict';

/**
 * Report query performance indexes:
 * - ledger / note date + vendor filters used by every finance report
 * - export log status polling
 */
module.exports = {
  async up(queryInterface) {
    const add = async (table, name, fields) => {
      try {
        await queryInterface.addIndex(table, fields, { name });
      } catch (err) {
        // Idempotent when re-run against partially migrated DBs.
        if (!String(err?.message ?? err).includes('already exists')) throw err;
      }
    };

    await add('commission_ledgers', 'commission_ledgers_created_at_idx', ['createdAt']);
    await add('commission_ledgers', 'commission_ledgers_vendor_created_idx', [
      'vendorId',
      'createdAt',
    ]);
    await add('commission_ledgers', 'commission_ledgers_sub_order_idx', ['subOrderId']);

    await add('tcs_ledgers', 'tcs_ledgers_created_at_idx', ['createdAt']);
    await add('tcs_ledgers', 'tcs_ledgers_vendor_created_idx', ['vendorId', 'createdAt']);
    await add('tcs_ledgers', 'tcs_ledgers_order_idx', ['orderId']);
    await add('tcs_ledgers', 'tcs_ledgers_period_idx', ['period']);

    await add('tds_ledgers', 'tds_ledgers_created_at_idx', ['createdAt']);
    await add('tds_ledgers', 'tds_ledgers_vendor_created_idx', ['vendorId', 'createdAt']);

    await add('credit_notes', 'credit_notes_order_idx', ['orderId']);
    await add('credit_notes', 'credit_notes_issued_at_idx', ['issuedAt']);
    await add('debit_notes', 'debit_notes_vendor_issued_idx', ['vendorId', 'issuedAt']);

    await add('orders', 'orders_created_payment_idx', ['createdAt', 'paymentStatus']);
    await add('sub_orders', 'sub_orders_vendor_created_idx', ['vendorId', 'createdAt']);

    await add('report_export_logs', 'report_export_logs_status_exported_idx', [
      'status',
      'exportedAt',
    ]);
  },

  async down(queryInterface) {
    const drop = async (table, name) => {
      try {
        await queryInterface.removeIndex(table, name);
      } catch {
        /* ignore */
      }
    };
    await drop('commission_ledgers', 'commission_ledgers_created_at_idx');
    await drop('commission_ledgers', 'commission_ledgers_vendor_created_idx');
    await drop('commission_ledgers', 'commission_ledgers_sub_order_idx');
    await drop('tcs_ledgers', 'tcs_ledgers_created_at_idx');
    await drop('tcs_ledgers', 'tcs_ledgers_vendor_created_idx');
    await drop('tcs_ledgers', 'tcs_ledgers_order_idx');
    await drop('tcs_ledgers', 'tcs_ledgers_period_idx');
    await drop('tds_ledgers', 'tds_ledgers_created_at_idx');
    await drop('tds_ledgers', 'tds_ledgers_vendor_created_idx');
    await drop('credit_notes', 'credit_notes_order_idx');
    await drop('credit_notes', 'credit_notes_issued_at_idx');
    await drop('debit_notes', 'debit_notes_vendor_issued_idx');
    await drop('orders', 'orders_created_payment_idx');
    await drop('sub_orders', 'sub_orders_vendor_created_idx');
    await drop('report_export_logs', 'report_export_logs_status_exported_idx');
  },
};
