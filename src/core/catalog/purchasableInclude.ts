import { Category } from '@database/models/category.model';
import { Vendor } from '@database/models/vendor.model';

/**
 * What `customerVisibility` needs loaded with a product: its seller and its category's status.
 * Every query whose products are tested with `resolveItemAvailability` or
 * `isProductCustomerVisible` includes these; a product loaded without them reads as unavailable.
 */
export const PURCHASABLE_PRODUCT_INCLUDE = [
  { model: Vendor, as: 'vendor' },
  { model: Category, attributes: ['id', 'status'] },
];
