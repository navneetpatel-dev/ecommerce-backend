/**
 * Domains reserved for documentation and testing (RFC 2606 / RFC 6761). Mail to them can
 * never be delivered, so sending it only produces bounces — which hurt the sending
 * account's reputation (seed data and demo accounts all use example.com).
 */
const RESERVED_SUFFIXES = ['.test', '.example', '.invalid', '.localhost', '.local'];
const RESERVED_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'localhost']);

export function isReservedTestDomain(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return false;
  if (RESERVED_DOMAINS.has(domain)) return true;
  return RESERVED_SUFFIXES.some((suffix) => domain.endsWith(suffix)) || [...RESERVED_DOMAINS].some((reserved) => domain.endsWith(`.${reserved}`));
}
