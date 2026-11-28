/**
 * Which products a shopper finds under a category: those filed in it or anywhere below it, as
 * their primary category or as a secondary one. GST, commission and COD always follow the
 * primary category; admin counts, coupons and reports use the primary category only.
 */

/** The id of the category `rootSql` and of everything under it. */
export const categorySubtreeSql = (rootSql: string) =>
  `WITH RECURSIVE subtree AS (
     SELECT id FROM categories WHERE id = ${rootSql}
     UNION
     SELECT child.id FROM categories child INNER JOIN subtree ON child."parentId" = subtree.id
   ) SELECT id FROM subtree`;

/**
 * Condition on the products table aliased `alias`: in one of the categories `idsSql` selects,
 * by its primary category or by a live secondary link to an active one.
 */
export const inCategoriesSql = (alias: string, idsSql: string) =>
  `(${alias}."categoryId" IN (${idsSql}) OR EXISTS (
     SELECT 1 FROM product_categories link
     INNER JOIN categories tagged ON tagged.id = link."categoryId" AND tagged.status = 'ACTIVE'
     WHERE link."productId" = ${alias}.id AND link."deletedAt" IS NULL AND link."categoryId" IN (${idsSql})
   ))`;

/** For search queries: the `:categoryId` replacement and everything under it. */
export const inSelectedCategorySql = inCategoriesSql('p', categorySubtreeSql(':categoryId::uuid'));
