import { QueryTypes } from 'sequelize';
import { sequelize } from '@database/models';
import { WebVital } from '@database/models/webVital.model';
import type { RecordWebVitalRequest, WebVitalsSummaryRequest } from './webVitals.dto';

export interface WebVitalSummaryRow {
  name: string;
  path: string;
  p75: number;
  sampleCount: number;
}

export class WebVitalsService {
  async record(data: RecordWebVitalRequest, userId: string | null) {
    await WebVital.create({
      name: data.name,
      value: data.value,
      rating: data.rating ?? null,
      path: data.path ?? null,
      effectiveType: data.effectiveType ?? null,
      userId,
    });
  }

  /**
   * p75 per metric name, grouped by page path, over a date range. CLS is
   * stored client-side scaled by 1000 (see web/src/shared/utils/webVitals.ts)
   * to keep the column an integer-friendly FLOAT alongside millisecond
   * metrics — callers displaying CLS should divide the returned p75 by 1000.
   */
  async summary(query: WebVitalsSummaryRequest): Promise<WebVitalSummaryRow[]> {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

    const rows = await sequelize.query<{ name: string; path: string | null; p75: string; sampleCount: string }>(
      `SELECT
         name,
         path,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
         COUNT(*)::int AS "sampleCount"
       FROM web_vitals
       WHERE "createdAt" BETWEEN :from AND :to
         ${query.path ? 'AND path = :path' : ''}
       GROUP BY name, path
       ORDER BY name ASC, path ASC NULLS LAST`,
      {
        replacements: { from, to, path: query.path ?? null },
        type: QueryTypes.SELECT,
      },
    );

    return rows.map((row) => ({
      name: row.name,
      path: row.path ?? '(unknown)',
      p75: Number(row.p75 ?? 0),
      sampleCount: Number(row.sampleCount ?? 0),
    }));
  }
}

export const webVitalsService = new WebVitalsService();
