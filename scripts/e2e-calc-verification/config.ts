import { config as loadDotenv } from 'dotenv';
import path from 'node:path';

loadDotenv({ path: path.resolve(__dirname, '../../.env') });

export const CONFIG = {
  baseUrl: process.env.E2E_BASE_URL || `http://localhost:${process.env.PORT || 9000}`,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  tolerance: 0.02, // rupees
};
