import type { ExportSource } from './exportTypes';

export type ExportActor = {
  id: string;
  vendorId?: string | null;
  roleName: string;
  permissions: string[];
};

export type ExportSourceResolver = (
  actor: ExportActor,
  exportType: string,
  filters: Record<string, unknown>,
) => Promise<ExportSource>;

const registry = new Map<string, ExportSourceResolver>();

/** Call once at module load time (e.g. top of reports.routes.ts) — never inside a request. */
export function registerExportDomain(domain: string, resolver: ExportSourceResolver): void {
  if (registry.has(domain)) return; // idempotent under tsx watch / hot reload
  registry.set(domain, resolver);
}

export function resolveExportSource(domain: string): ExportSourceResolver {
  const resolver = registry.get(domain);
  if (!resolver) {
    throw new Error(`No export source registered for domain "${domain}"`);
  }
  return resolver;
}

export function listRegisteredExportDomains(): string[] {
  return [...registry.keys()];
}
