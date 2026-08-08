import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Order } from '@database/models/order.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import {
  assertReportRange,
  pagedFindAndCount,
  emptyPage,
  dateBetween,
} from '../engine/queryHelpers';

function requireVendorId(filters: ReportFilters): string {
  return filters.scopedVendorId ?? filters.vendorId ?? '';
}

async function staffOrders(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = requireVendorId(filters);
  if (!vendorId) return emptyPage(filters);

  const where: Record<string, unknown> = {
    vendorId,
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.status = filters.status;

  const categoryRequired = Boolean(filters.categoryId);

  const { rows, total } = await pagedFindAndCount(
    OrderItem,
    {
      include: [
        {
          model: SubOrder,
          as: 'subOrder',
          required: true,
          where,
          include: [
            {
              model: Order,
              as: 'order',
              required: true,
              attributes: ['id', 'status', 'createdAt', 'userId'],
            },
          ],
        },
        {
          model: ProductVariant,
          as: 'variant',
          required: categoryRequired,
          attributes: ['id', 'sku'],
          include: [
            {
              model: Product,
              as: 'product',
              required: categoryRequired,
              attributes: ['id', 'name'],
              where: filters.categoryId ? { categoryId: filters.categoryId } : undefined,
            },
          ],
        },
      ],
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((item) => {
      const sub = (item as OrderItem & {
        subOrder?: SubOrder & { order?: Order };
      }).subOrder;
      const variant = (item as OrderItem & {
        variant?: ProductVariant & { product?: Product };
      }).variant;
      return {
        orderId: sub?.orderId ?? null,
        subOrderId: item.subOrderId,
        orderStatus: sub?.order?.status ?? null,
        subOrderStatus: sub?.status ?? null,
        productName: item.productName,
        sku: variant?.sku ?? null,
        quantity: Number(item.quantity ?? 0),
        createdAt: sub?.order?.createdAt ?? item.createdAt,
      };
    }),
    total,
  };
}

async function staffInventory(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = requireVendorId(filters);
  if (!vendorId) return emptyPage(filters);

  const productWhere: Record<string, unknown> = { vendorId };
  if (filters.categoryId) productWhere.categoryId = filters.categoryId;
  if (filters.status) productWhere.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    ProductVariant,
    {
      include: [
        {
          model: Product,
          as: 'product',
          required: true,
          where: productWhere,
          attributes: ['id', 'name', 'categoryId', 'status'],
        },
      ],
      order: [['sku', 'ASC']],
    },
    filters,
  );

  return {
    rows: rows.map((v) => {
      const product = (v as ProductVariant & { product?: Product }).product;
      const stock = Number(v.stock ?? 0);
      const lowStockAt = Number(v.lowStockAt ?? 0);
      return {
        variantId: v.id,
        sku: v.sku,
        productId: product?.id ?? v.productId,
        productName: product?.name ?? '',
        stock,
        lowStockAt,
        isLowStock: stock <= lowStockAt,
      };
    }),
    total,
  };
}

export const vendorStaffReports: ReportDefinition[] = [
  {
    type: 'staff-orders',
    labelKey: 'reportStaffOrders',
    audience: 'vendor_staff',
    permissions: [PERMISSIONS.SUBORDER_MANAGE],
    vendorScoped: true,
    financial: false,
    columns: [
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'orderStatus', labelKey: 'orderStatus' },
      { key: 'subOrderStatus', labelKey: 'subOrderStatus' },
      { key: 'productName', labelKey: 'productName' },
      { key: 'sku', labelKey: 'sku' },
      { key: 'quantity', labelKey: 'quantity', format: 'number' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
    ],
    query: staffOrders,
  },
  {
    type: 'staff-inventory',
    labelKey: 'reportStaffInventory',
    audience: 'vendor_staff',
    permissions: [PERMISSIONS.PRODUCT_UPDATE],
    vendorScoped: true,
    financial: false,
    columns: [
      { key: 'sku', labelKey: 'sku' },
      { key: 'productName', labelKey: 'productName' },
      { key: 'stock', labelKey: 'stock', format: 'number' },
      { key: 'lowStockAt', labelKey: 'lowStockAt', format: 'number' },
      { key: 'isLowStock', labelKey: 'isLowStock' },
    ],
    query: staffInventory,
  },
];
