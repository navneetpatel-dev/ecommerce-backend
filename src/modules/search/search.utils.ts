/** Escape `%`, `_`, and `\` for safe `ILIKE … ESCAPE '\'` patterns. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function buildAutocompleteLikePatterns(term: string) {
  const escaped = escapeLikePattern(term.trim());
  return {
    prefixPattern: `${escaped}%`,
    infixPattern: `%${escaped}%`,
  };
}

/** Letters and digits in a query; punctuation alone ("%", "!!") is not something to search for (C-17). */
export function searchableLength(term: string): number {
  return term.replace(/[^\p{L}\p{M}\p{N}]+/gu, '').length;
}
