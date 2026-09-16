import { CONFIG } from '../config';

const tokenCache = new Map<string, string>();

export async function apiFetch(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const body = opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
  const res = await fetch(`${CONFIG.baseUrl}${path}`, { method, headers, body });
  let json: any = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

export async function loginAs(email: string, password: string): Promise<string> {
  const cached = tokenCache.get(email);
  if (cached) return cached;
  const { status, json } = await apiFetch('POST', '/api/auth/login', { body: { email, password } });
  if (status !== 200 || !json?.data?.accessToken) {
    throw new Error(`Login failed for ${email}: status=${status} body=${JSON.stringify(json)}`);
  }
  tokenCache.set(email, json.data.accessToken);
  return json.data.accessToken;
}

export function getCachedUser(email: string): string | undefined {
  return tokenCache.get(email);
}

export async function get(path: string, token?: string) {
  return apiFetch('GET', path, { token });
}
export async function post(path: string, body: unknown, token?: string) {
  return apiFetch('POST', path, { token, body });
}
export async function patch(path: string, body: unknown, token?: string) {
  return apiFetch('PATCH', path, { token, body });
}
