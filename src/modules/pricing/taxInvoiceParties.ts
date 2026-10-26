import type { Transaction } from 'sequelize';
import { Address } from '@database/models/address.model';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import type { TaxInvoiceParties } from './taxInvoiceSnapshot';

const blankToNull = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

/** The parties as they stand now: called once, as the invoice is issued. */
export async function currentInvoiceParties(
  subOrder: SubOrder,
  transaction: Transaction,
): Promise<TaxInvoiceParties> {
  const vendor = subOrder.vendorId
    ? await Vendor.findByPk(subOrder.vendorId, {
        attributes: ['businessName', 'gstNumber', 'state'],
        paranoid: false,
        transaction,
      })
    : null;
  const order = await Order.findByPk(subOrder.orderId, { attributes: ['shippingAddressId'], transaction });
  const address = order?.shippingAddressId
    ? await Address.findByPk(order.shippingAddressId, { paranoid: false, transaction })
    : null;
  return {
    supplierName: vendor?.businessName ?? null,
    supplierGstin: blankToNull(vendor?.gstNumber),
    supplierState: blankToNull(vendor?.state),
    recipientGstin: blankToNull(address?.gstin),
    recipientState: blankToNull(address?.state),
    recipientAddress: address
      ? {
          line1: address.line1,
          line2: address.line2 ?? null,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          country: address.country,
        }
      : null,
  };
}
