/**
 * SQL for "this order line matches the search": its product name, or the SKU of the variant
 * bought (the line itself stores no SKU). `escapedTerm` must already be a quoted SQL literal.
 */
export const orderItemMatchesSql = (alias: string, escapedTerm: string): string =>
  `(${alias}."productName" ILIKE ${escapedTerm} OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.id = ${alias}."variantId" AND pv."sku" ILIKE ${escapedTerm}))`;
