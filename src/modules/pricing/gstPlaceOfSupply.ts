function normalizeState(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Whether a supply by the platform is intra-state (CGST + SGST) rather than inter-state
 * (IGST): the platform's registered state matches the place of supply. Until the
 * platform state is configured, it is treated as intra-state.
 */
export function isIntraStateSupply(
  supplierState: string | null | undefined,
  placeOfSupplyState: string | null | undefined,
): boolean {
  const supplier = normalizeState(supplierState);
  const place = normalizeState(placeOfSupplyState);
  if (!supplier && place) return true;
  return Boolean(supplier && place && supplier === place);
}
