import { get } from './httpClient';

export async function runReport(
  token: string,
  type: string,
  params: Record<string, string | undefined> = {},
): Promise<{ status: number; rows: any[]; meta?: any; raw: any }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, v);
  }
  qs.set('format', 'json');
  const { status, json } = await get(`/api/reports/run/${type}?${qs.toString()}`, token);
  const rows = json?.data?.rows ?? json?.rows ?? (Array.isArray(json?.data) ? json.data : []);
  const meta = json?.data?.meta ?? json?.meta ?? json?.data;
  return { status, rows, meta, raw: json };
}

export function findRowBy(rows: any[], predicate: (row: any) => boolean): any | undefined {
  return rows.find(predicate);
}
