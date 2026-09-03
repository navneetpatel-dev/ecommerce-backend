import { WebVital } from '@database/models/webVital.model';
import type { RecordWebVitalRequest } from './webVitals.dto';

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
}

export const webVitalsService = new WebVitalsService();
