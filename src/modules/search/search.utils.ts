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
