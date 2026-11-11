/**
 * The values a filter offers for one attribute. The options column is JSON and has
 * held objects and null in real data, so anything that is not a list counts as no
 * options instead of crashing the whole filter list. List entries may be plain
 * values or `{ value, label }` objects.
 */
export function facetOptionValues(attr: { type: string; options: unknown }): string[] {
  if (attr.type === 'BOOLEAN') return ['true', 'false'];
  if (!Array.isArray(attr.options)) return [];
  const values = attr.options
    .map((opt) => {
      if (opt !== null && typeof opt === 'object') {
        const entry = opt as { value?: unknown; label?: unknown };
        return entry.value ?? entry.label ?? null;
      }
      return opt;
    })
    .filter((value): value is string | number | boolean => value !== null && value !== undefined && value !== '')
    .map((value) => String(value));
  return [...new Set(values)];
}
