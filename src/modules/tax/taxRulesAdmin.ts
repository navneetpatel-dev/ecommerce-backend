import { NotFoundError } from '@core/errors/NotFoundError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { Category } from '@database/models/category.model';
import { TaxRule } from '@database/models/taxRule.model';
import { sequelize } from '@database/models';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { logAudit } from '@modules/audit/audit.service';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { escapeLikePattern } from '@modules/search/search.utils';
import { loadCategoryRules } from './taxRuleResolution';
import type { TaxRuleListQuery } from './tax.dto';

/** What an audit entry records of a rule. */
function ruleSnapshot(rule: TaxRule) {
  return {
    categoryId: rule.categoryId ?? null,
    hsnCode: rule.hsnCode ?? null,
    gstPercentage: Number(rule.gstPercentage),
    priceBandThreshold: rule.priceBandThreshold != null ? Number(rule.priceBandThreshold) : null,
    gstPercentageAbove: rule.gstPercentageAbove != null ? Number(rule.gstPercentageAbove) : null,
  };
}

async function categoryName(categoryId: string | null | undefined, transaction: Transaction): Promise<string | null> {
  if (!categoryId) return null;
  return (await Category.findByPk(categoryId, { attributes: ['name'], transaction }))?.name ?? null;
}

function serializeTaxRule(row: TaxRule) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  return {
    id: plain.id,
    hsnCode: plain.hsnCode,
    gstPercentage: Number(plain.gstPercentage),
    priceBandThreshold: plain.priceBandThreshold != null ? Number(plain.priceBandThreshold) : null,
    gstPercentageAbove: plain.gstPercentageAbove != null ? Number(plain.gstPercentageAbove) : null,
    categoryId: plain.categoryId ?? null,
    isDefault: !plain.categoryId,
    categoryName: plain.category?.name ?? null,
    createdAt: plain.createdAt,
  };
}


export async function listTaxRules(query: TaxRuleListQuery) {
  const offset = paginationOffset(query.page, query.limit);
  const where: WhereOptions[] = [];
  if (query.scope === 'default') where.push({ categoryId: null });
  if (query.scope === 'category') where.push({ categoryId: { [Op.ne]: null } });
  if (query.categoryId) where.push({ categoryId: query.categoryId });
  if (query.gstPercentage !== undefined) where.push({ gstPercentage: query.gstPercentage });
  if (query.hasBand === 'YES') where.push({ priceBandThreshold: { [Op.ne]: null } });
  if (query.hasBand === 'NO') where.push({ priceBandThreshold: null });
  const search = query.search ? escapeLikePattern(query.search) : '';
  if (search) {
    where.push({
      [Op.or]: [{ hsnCode: { [Op.iLike]: `%${search}%` } }, { '$category.name$': { [Op.iLike]: `%${search}%` } }],
    });
  }

  const { rows, count } = await TaxRule.findAndCountAll({
    where: { [Op.and]: where },
    include: [{ model: Category, as: 'category', attributes: ['id', 'name'], required: false }],
    order: [['createdAt', 'DESC'], ['id', 'ASC']],
    limit: query.limit,
    offset,
    distinct: true,
    col: 'id',
  });
  // How many categories each rule decides the GST of (its own, inherited and, for the default, the rest).
  const applies = new Map<string, number>();
  for (const resolved of await loadCategoryRules()) {
    if (resolved.ruleId) applies.set(resolved.ruleId, (applies.get(resolved.ruleId) ?? 0) + 1);
  }
  return {
    rules: rows.map((row) => ({ ...serializeTaxRule(row), appliesToCount: applies.get(row.id) ?? 0 })),
    pagination: buildPaginationMeta(count, query.page, query.limit),
  };
}

/** One rule per category and one default: with two, which GST applied was arbitrary. */
async function assertRuleUnique(categoryId: string | null, excludeId: string | null, transaction: Transaction) {
  if (categoryId) {
    const category = await Category.findByPk(categoryId, { attributes: ['id'], transaction });
    if (!category) throw new NotFoundError('Category');
  }
  const where: WhereOptions = { categoryId, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) };
  if ((await TaxRule.count({ where, transaction })) > 0) {
    throw new ValidationError(categoryId ? ERROR_MESSAGES.TAX_RULE_CATEGORY_EXISTS : ERROR_MESSAGES.TAX_DEFAULT_RULE_EXISTS);
  }
}

export async function createTaxRule(
  data: {
    categoryId?: string | null;
    hsnCode?: string | null;
    gstPercentage: number;
    priceBandThreshold?: number | null;
    gstPercentageAbove?: number | null;
  },
  actorId?: string,
) {
  return sequelize.transaction(async (t) => {
    const categoryId = data.categoryId ?? null;
    await assertRuleUnique(categoryId, null, t);
    const rule = await TaxRule.create(
      {
        categoryId,
        hsnCode: data.hsnCode ?? null,
        gstPercentage: data.gstPercentage,
        priceBandThreshold: data.priceBandThreshold ?? null,
        gstPercentageAbove: data.gstPercentageAbove ?? null,
        ...(actorId ? { createdBy: actorId, updatedBy: actorId } : {}),
      },
      { transaction: t },
    );

    if (actorId) {
      await logAudit({
        actorId,
        action: 'TAX_RULE_CREATED',
        entityType: 'TaxRule',
        entityId: rule.id,
        metadata: { after: ruleSnapshot(rule), categoryName: await categoryName(categoryId, t) },
        transaction: t,
      });
    }

    return rule;
  });
}

export async function updateTaxRule(
  id: string,
  data: {
    categoryId?: string | null;
    hsnCode?: string | null;
    gstPercentage?: number;
    priceBandThreshold?: number | null;
    gstPercentageAbove?: number | null;
  },
  actorId?: string,
) {
  return sequelize.transaction(async (t) => {
    const rule = await TaxRule.findByPk(id, { transaction: t });
    if (!rule) throw new NotFoundError('TaxRule');
    const before = ruleSnapshot(rule);

    if (data.categoryId !== undefined && (data.categoryId ?? null) !== (rule.categoryId ?? null)) {
      await assertRuleUnique(data.categoryId ?? null, id, t);
    }
    const patch = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
    await rule.update({ ...patch, ...(actorId ? { updatedBy: actorId } : {}) }, { transaction: t });

    if (actorId) {
      await logAudit({
        actorId,
        action: 'TAX_RULE_UPDATED',
        entityType: 'TaxRule',
        entityId: id,
        metadata: { before, after: ruleSnapshot(rule), categoryName: await categoryName(rule.categoryId, t) },
        transaction: t,
      });
    }

    return rule;
  });
}

/** `force` is needed for the default rule: deleting it changes every category without its own rule. */
export async function deleteTaxRule(id: string, actorId?: string, force = false) {
  return sequelize.transaction(async (t) => {
    const rule = await TaxRule.findByPk(id, { transaction: t });
    if (!rule) throw new NotFoundError('TaxRule');
    if (!rule.categoryId && !force) throw new ValidationError(ERROR_MESSAGES.TAX_DEFAULT_RULE_IN_USE);

    const before = ruleSnapshot(rule);
    const name = await categoryName(rule.categoryId, t);
    await rule.destroy({ transaction: t });

    if (actorId) {
      await logAudit({
        actorId,
        action: 'TAX_RULE_DELETED',
        entityType: 'TaxRule',
        entityId: id,
        metadata: { before, categoryName: name },
        transaction: t,
      });
    }
  });
}
