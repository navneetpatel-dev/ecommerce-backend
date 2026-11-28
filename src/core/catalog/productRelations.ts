import type { PlainRow } from '@core/repository/toPlain';
import type { CartItem } from '@database/models/cartItem.model';
import type { Category } from '@database/models/category.model';
import type { Product } from '@database/models/product.model';
import type { ProductImage } from '@database/models/productImage.model';
import type { ProductVariant } from '@database/models/productVariant.model';
import type { Vendor } from '@database/models/vendor.model';

/** A product with the relations a query included, under either name Sequelize gives them. */
export type ProductWithRelations = Product & {
  vendor?: Vendor | null;
  Vendor?: Vendor | null;
  category?: Category | null;
  Category?: Category | null;
  images?: ProductImage[];
  variants?: ProductVariant[];
};

/** A cart line loaded with its variant and that variant's product. */
export type CartItemWithProduct = CartItem & { variant: ProductVariant & { product: ProductWithRelations } };

type CategoryRef = PlainRow<Category> | null;
type VendorRef = PlainRow<Vendor> | null;

/** The same, as plain data: what the product serializers read. */
export type PlainProduct = Omit<PlainRow<Product>, 'compareAtPrice'> & (
  {
    /** Read straight from the database it can be a decimal string. */
    compareAtPrice?: number | string | null;
    vendor?: VendorRef;
    Vendor?: VendorRef;
    category?: CategoryRef;
    Category?: CategoryRef;
    categoryName?: string | null;
    vendorName?: string | null;
    imageUrl?: string | null;
    stock?: number | string | null;
    reviewCount?: number | string | null;
    images?: Array<PlainRow<ProductImage>>;
    variants?: Array<PlainRow<ProductVariant>>;
    secondaryCategories?: Array<PlainRow<Category>>;
  }
);
