import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it, mock } from 'node:test';
import type { Product } from '@database/models/product.model';
import { Product as ProductModel } from '@database/models/product.model';
import { TaxRule } from '@database/models/taxRule.model';
import { sequelize } from '@database/models';
import { categoriesService } from '@modules/categories/categories.service';
import { resolvePdpPolicy } from '@modules/products/pdpPolicy';
import { settingsService } from '@modules/settings/settings.service';
import { taxRepository } from '@modules/tax/tax.repository';
import { taxService } from '@modules/tax/tax.service';

type ChainNode = { id: string; returnWindowDays?: number | null; defaultWarrantyMonths?: number | null; defaultWarrantyType?: string | null; codEnabled?: boolean };
type Rule = { gstPercentage: number; hsnCode: string | null };

/**
 * Exact pre-consolidation PDP GST loop, kept here so old vs new can be
 * diffed without relying on the replaced production body.
 */
async function legacyPdpGstLoop(product: { categoryId?: string | null; hsnCode?: string | null }): Promise<{
  gstPercentage: number;
  hsnCode: string | null;
}> {
  const chain = product.categoryId
    ? await categoriesService.walkCategoryAncestors(product.categoryId)
    : [];
  let gstPercentage = 18;
  let hsnCode = product.hsnCode?.trim() || null;
  let foundTaxRule = false;
  for (const node of chain) {
    const rule = await taxRepository.findByCategory(node.id);
    if (rule) {
      foundTaxRule = true;
      gstPercentage = Number(rule.gstPercentage);
      if (!hsnCode && rule.hsnCode) hsnCode = String(rule.hsnCode);
      break;
    }
  }
  if (!foundTaxRule) {
    const fallback = await taxRepository.findDefault();
    if (fallback) {
      gstPercentage = Number(fallback.gstPercentage);
      if (!hsnCode && fallback.hsnCode) hsnCode = String(fallback.hsnCode);
    }
  }
  return { gstPercentage, hsnCode };
}

function mockTaxGraph(opts: {
  chainByCategory: Record<string, ChainNode[]>;
  rulesByCategory: Record<string, Rule | null>;
  defaultRule: Rule | null;
}) {
  mock.method(categoriesService, 'walkCategoryAncestors', async (categoryId: string) => {
    return opts.chainByCategory[categoryId] ?? [];
  });
  mock.method(taxRepository, 'findByCategory', async (categoryId: string) => {
    return opts.rulesByCategory[categoryId] ?? null;
  });
  mock.method(taxRepository, 'findDefault', async () => opts.defaultRule);
  mock.method(settingsService, 'getPlatformSettings', async () => ({
    defaultReturnWindow: 7,
    returnShippingFee: 0,
    codEnabled: true,
    codMinOrderValue: 0,
    codMaxOrderValue: null,
  }));
}

function product(partial: { id?: string; categoryId?: string | null; hsnCode?: string | null }): Product {
  return {
    id: partial.id ?? 'prod-1',
    categoryId: partial.categoryId ?? null,
    hsnCode: partial.hsnCode ?? null,
    warrantyMonths: null,
    warrantyType: null,
    codEnabled: true,
  } as Product;
}

const MATRIX: Array<{
  name: string;
  product: { categoryId?: string | null; hsnCode?: string | null };
  graph: Parameters<typeof mockTaxGraph>[0];
}> = [
  {
    name: 'leaf category has its own TaxRule',
    product: { categoryId: 'leaf' },
    graph: {
      chainByCategory: { leaf: [{ id: 'leaf' }, { id: 'parent' }] },
      rulesByCategory: { leaf: { gstPercentage: 5, hsnCode: '0401' }, parent: { gstPercentage: 12, hsnCode: '9999' } },
      defaultRule: { gstPercentage: 18, hsnCode: '0000' },
    },
  },
  {
    name: 'leaf has no rule, parent override applies',
    product: { categoryId: 'leaf' },
    graph: {
      chainByCategory: { leaf: [{ id: 'leaf' }, { id: 'parent' }] },
      rulesByCategory: { leaf: null, parent: { gstPercentage: 12, hsnCode: '6109' } },
      defaultRule: { gstPercentage: 18, hsnCode: '0000' },
    },
  },
  {
    name: 'no category rule, default TaxRule applies',
    product: { categoryId: 'leaf' },
    graph: {
      chainByCategory: { leaf: [{ id: 'leaf' }] },
      rulesByCategory: { leaf: null },
      defaultRule: { gstPercentage: 28, hsnCode: '2402' },
    },
  },
  {
    name: 'no category, no default rule → 18% fallback',
    product: { categoryId: 'leaf' },
    graph: {
      chainByCategory: { leaf: [{ id: 'leaf' }] },
      rulesByCategory: { leaf: null },
      defaultRule: null,
    },
  },
  {
    name: 'product with no categoryId uses default rule',
    product: { categoryId: null },
    graph: {
      chainByCategory: {},
      rulesByCategory: {},
      defaultRule: { gstPercentage: 12, hsnCode: '4901' },
    },
  },
  {
    name: 'product with no categoryId and no default → 18%',
    product: { categoryId: null },
    graph: {
      chainByCategory: {},
      rulesByCategory: {},
      defaultRule: null,
    },
  },
];

describe('GST rate resolution parity (PDP vs taxService)', () => {
  afterEach(() => mock.restoreAll());

  for (const c of MATRIX) {
    it(`old PDP loop matches resolveEffectiveTaxRule / getGstRate: ${c.name}`, async () => {
      mockTaxGraph(c.graph);
      const prod = product(c.product);
      const legacy = await legacyPdpGstLoop(prod);
      const resolved = await taxService.resolveEffectiveTaxRule(prod.categoryId ?? undefined);
      const rate = await taxService.getGstRate(prod.categoryId ?? undefined);
      assert.equal(legacy.gstPercentage, resolved.gstPercentage);
      assert.equal(legacy.gstPercentage, rate);
    });

    it(`resolvePdpPolicy.gstPercentage === getGstRate: ${c.name}`, async () => {
      mockTaxGraph(c.graph);
      const prod = product(c.product);
      const policy = await resolvePdpPolicy(prod);
      const rate = await taxService.getGstRate(prod.categoryId ?? undefined);
      assert.equal(policy.gstPercentage, rate);
    });
  }
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

describe('GST rate resolution live category tree', () => {
  let dbReady = false;

  before(async () => {
    try {
      await withTimeout(sequelize.authenticate(), 2000);
      dbReady = true;
    } catch {
      dbReady = false;
    }
  });

  it('old PDP loop matches resolveEffectiveTaxRule for every category with a product or TaxRule', async (test) => {
    if (!dbReady) return test.skip('database unavailable');
    const [rules, products] = await Promise.all([
      TaxRule.findAll({ attributes: ['categoryId'] }),
      ProductModel.findAll({ attributes: ['id', 'categoryId', 'hsnCode'] }),
    ]);
    const categoryIds = new Set<string>();
    for (const rule of rules) {
      if (rule.categoryId) categoryIds.add(rule.categoryId);
    }
    for (const prod of products) {
      if (prod.categoryId) categoryIds.add(prod.categoryId);
    }

    const diffs: string[] = [];
    for (const categoryId of categoryIds) {
      const legacy = await legacyPdpGstLoop({ categoryId });
      const resolved = await taxService.resolveEffectiveTaxRule(categoryId);
      const rate = await taxService.getGstRate(categoryId);
      if (legacy.gstPercentage !== resolved.gstPercentage || legacy.gstPercentage !== rate) {
        diffs.push(
          `${categoryId}: legacy=${legacy.gstPercentage} resolved=${resolved.gstPercentage} rate=${rate}`,
        );
      }
    }

    const legacyNone = await legacyPdpGstLoop({ categoryId: null });
    const resolvedNone = await taxService.resolveEffectiveTaxRule(undefined);
    if (legacyNone.gstPercentage !== resolvedNone.gstPercentage) {
      diffs.push(
        `null category: legacy=${legacyNone.gstPercentage} resolved=${resolvedNone.gstPercentage}`,
      );
    }

    assert.equal(diffs.length, 0, diffs.join('\n'));
    assert.ok(categoryIds.size + rules.length > 0, 'expected at least one TaxRule or categorized product');
  });

  it('resolvePdpPolicy.gstPercentage === getGstRate for one product per live category', async (test) => {
    if (!dbReady) return test.skip('database unavailable');
    const products = await ProductModel.findAll({
      attributes: ['id', 'categoryId', 'hsnCode', 'warrantyMonths', 'warrantyType', 'codEnabled'],
    });
    const byCategory = new Map<string, Product>();
    for (const prod of products) {
      if (prod.categoryId && !byCategory.has(prod.categoryId)) {
        byCategory.set(prod.categoryId, prod);
      }
    }

    const diffs: string[] = [];
    for (const prod of byCategory.values()) {
      const policy = await resolvePdpPolicy(prod);
      const rate = await taxService.getGstRate(prod.categoryId ?? undefined);
      if (policy.gstPercentage !== rate) {
        diffs.push(`${prod.id} category=${prod.categoryId}: pdp=${policy.gstPercentage} rate=${rate}`);
      }
    }
    assert.equal(diffs.length, 0, diffs.join('\n'));
  });

  after(async () => {
    if (dbReady) {
      await sequelize.close().catch(() => undefined);
    }
  });
});
