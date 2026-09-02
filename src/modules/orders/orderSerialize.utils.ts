export function omitPaiseFields<T extends Record<string, unknown>>(row: T) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.endsWith('Paise')),
  ) as Omit<T, `${string}Paise`>;
}

export function hasPaiseFields(row: Record<string, unknown>): boolean {
  return Object.keys(row).some((key) => key.endsWith('Paise'));
}
