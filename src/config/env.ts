import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),

  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('ecommerce_dev'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().default('ecommerce-uploads'),
  /** Optional CDN / public base for object URLs (no trailing slash). */
  S3_PUBLIC_BASE_URL: z.string().url().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  SES_FROM_EMAIL: z.string().default('noreply@ecommerce.com'),
  /** Optional SES configuration set (bounce/complaint events). */
  SES_CONFIGURATION_SET: z.string().optional(),
  /** Force console transport even when AWS credentials exist (local debugging). */
  EMAIL_TRANSPORT: z.enum(['auto', 'ses', 'console']).default('auto'),
  /** Public storefront URL used in email CTAs. */
  CLIENT_URL: z.string().default('http://localhost:5173'),
  /** Hours of cart inactivity before abandoned-cart marketing email. */
  ABANDONED_CART_HOURS: z.coerce.number().int().positive().default(24),
  /** Days after delivery before review-request marketing email. */
  REVIEW_REQUEST_DELAY_DAYS: z.coerce.number().int().positive().default(2),
  /** Days after delivery before cashback wallet credit (0 = next scheduler tick after delivery). */
  CASHBACK_CREDIT_DELAY_DAYS: z.coerce.number().int().min(0).default(0),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  SENTRY_DSN: z.string().optional(),

  ADMIN_EMAIL: z.string().default('admin@ecommerce.com'),
  ADMIN_PASSWORD: z.string().default('Admin@123'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
