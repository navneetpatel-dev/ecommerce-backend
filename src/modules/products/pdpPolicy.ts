import { settingsService } from '@modules/settings/settings.service';
import { categoriesService } from '@modules/categories/categories.service';
import { taxService } from '@modules/tax/tax.service';
import { WARRANTY_TYPE, type WarrantyType } from '@core/constants/statuses';
import type { Product } from '@database/models/product.model';

export type PdpPolicy = {
  returnWindowDays: number | null;
  returnsAllowed: boolean;
  returnShippingFee: number;
  warrantyMonths: number | null;
  warrantyType: WarrantyType | null;
  gstPercentage: number;
  hsnCode: string | null;
  taxInclusive: false;
  codEnabled: boolean;
  codMinOrderValue: number;
  codMaxOrderValue: number | null;
  vendorPerformanceScore: number | null;
};

function asWarrantyType(value: unknown): WarrantyType | null {
  if (value === WARRANTY_TYPE.MANUFACTURER || value === WARRANTY_TYPE.SELLER) return value;
  return null;
}

export async function resolveReturnWindowForCategory(
  categoryId: string | null | undefined,
): Promise<{ returnWindowDays: number | null; returnsAllowed: boolean }> {
  const settings = await settingsService.getPlatformSettings();
  const chain = categoryId ? await categoriesService.walkCategoryAncestors(categoryId) : [];

  let returnWindowDays: number | null = null;
  for (const node of chain) {
    if (node.returnWindowDays != null) {
      returnWindowDays = Number(node.returnWindowDays);
      break;
    }
  }
  if (returnWindowDays == null) {
    returnWindowDays = Number(settings.defaultReturnWindow ?? 7);
  }
  const returnsAllowed = returnWindowDays > 0;
  return {
    returnWindowDays: returnsAllowed ? returnWindowDays : null,
    returnsAllowed,
  };
}

export async function resolvePdpPolicy(product: Product): Promise<PdpPolicy> {
  const settings = await settingsService.getPlatformSettings();
  const chain = product.categoryId
    ? await categoriesService.walkCategoryAncestors(product.categoryId)
    : [];

  const returnWindow = await resolveReturnWindowForCategory(product.categoryId);
  const { returnWindowDays, returnsAllowed } = returnWindow;

  let warrantyMonths =
    product.warrantyMonths != null ? Number(product.warrantyMonths) : null;
  let warrantyType = asWarrantyType(product.warrantyType);
  if (warrantyMonths == null) {
    for (const node of chain) {
      if (node.defaultWarrantyMonths != null) {
        warrantyMonths = Number(node.defaultWarrantyMonths);
        warrantyType = warrantyType ?? asWarrantyType(node.defaultWarrantyType);
        break;
      }
    }
  }
  if (warrantyMonths != null && warrantyMonths > 0 && !warrantyType) {
    warrantyType = WARRANTY_TYPE.MANUFACTURER;
  }
  if (warrantyMonths != null && warrantyMonths <= 0) {
    warrantyMonths = null;
    warrantyType = null;
  }

  const effectiveTaxRule = await taxService.resolveEffectiveTaxRule(product.categoryId ?? undefined);
  const gstPercentage = effectiveTaxRule.gstPercentage;
  const hsnCode = product.hsnCode?.trim() || effectiveTaxRule.hsnCode;

  const vendor = (product as Product & {
    vendor?: { returnShippingFee?: number | null; performanceScore?: number | null; codEnabled?: boolean };
  }).vendor;

  const returnShippingFee =
    vendor?.returnShippingFee != null
      ? Number(vendor.returnShippingFee)
      : Number(settings.returnShippingFee ?? 0);

  let categoryCod = true;
  for (const node of chain) {
    if (node.codEnabled === false) {
      categoryCod = false;
      break;
    }
  }
  const vendorCod = vendor?.codEnabled !== false;
  const productCod = product.codEnabled !== false;
  const platformCod = settings.codEnabled !== false;
  const codEnabled = platformCod && categoryCod && vendorCod && productCod;

  return {
    returnWindowDays: returnsAllowed ? returnWindowDays : null,
    returnsAllowed,
    returnShippingFee,
    warrantyMonths,
    warrantyType,
    gstPercentage,
    hsnCode,
    taxInclusive: false,
    codEnabled,
    codMinOrderValue: Number(settings.codMinOrderValue ?? 0),
    codMaxOrderValue:
      settings.codMaxOrderValue == null ? null : Number(settings.codMaxOrderValue),
    vendorPerformanceScore:
      vendor?.performanceScore == null ? null : Number(vendor.performanceScore),
  };
}

export async function resolveCodForCatalogItems(
  items: Array<{
    categoryId?: string | null;
    codEnabled?: boolean | null;
    vendor?: { codEnabled?: boolean | null } | null;
  }>,
  orderTotal: number,
): Promise<boolean> {
  if (!items.length) return false;
  const settings = await settingsService.getPlatformSettings();
  if (settings.codEnabled === false) return false;
  if (orderTotal < Number(settings.codMinOrderValue ?? 0)) return false;
  if (settings.codMaxOrderValue != null && orderTotal > Number(settings.codMaxOrderValue)) {
    return false;
  }

  const seenCategories = new Map<string, boolean>();
  for (const item of items) {
    if (item.codEnabled === false) return false;
    if (item.vendor?.codEnabled === false) return false;
    const categoryId = item.categoryId ?? null;
    if (!categoryId) continue;
    let categoryCod = seenCategories.get(categoryId);
    if (categoryCod === undefined) {
      const chain = await categoriesService.walkCategoryAncestors(categoryId);
      categoryCod = !chain.some((node) => node.codEnabled === false);
      seenCategories.set(categoryId, categoryCod);
    }
    if (!categoryCod) return false;
  }
  return true;
}

export async function resolveCodEligibleAtPrice(
  product: {
    categoryId?: string | null;
    codEnabled?: boolean | null;
    vendor?: { codEnabled?: boolean | null } | null;
  },
  unitPrice: number,
): Promise<boolean> {
  return resolveCodForCatalogItems(
    [
      {
        categoryId: product.categoryId ?? null,
        codEnabled: product.codEnabled ?? null,
        vendor: product.vendor ?? null,
      },
    ],
    unitPrice,
  );
}
