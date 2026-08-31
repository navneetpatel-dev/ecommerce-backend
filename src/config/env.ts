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
  /** Optional Dashboard checkout configuration (Test/Live each has its own ID). */
  RAZORPAY_CHECKOUT_CONFIG_ID: z.string().optional(),

  /**
   * Mail driver. Add a MailProvider in mail.providers.ts + register it in mail.ts
   * when introducing another email system. `auto` resolves: ses → smtp → console.
   */
  MAIL_DRIVER: z.enum(['auto', 'console', 'ses', 'smtp']).default('auto'),
  MAIL_FROM_EMAIL: z.string().default('noreply@ecommerce.com'),
  MAIL_FROM_NAME: z.string().default('Ecommerce'),

  /** Optional SES configuration set (bounce/complaint events). */
  SES_CONFIGURATION_SET: z.string().optional(),

  /** SMTP settings when MAIL_DRIVER=smtp (any SMTP-compatible service). */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return false;
      if (typeof v === 'boolean') return v;
      return v === 'true' || v === '1';
    }),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  /** Public storefront URL used in email CTAs. */
  CLIENT_URL: z.string().default('http://localhost:5173'),
  /** Hours of cart inactivity before abandoned-cart marketing email. */
  ABANDONED_CART_HOURS: z.coerce.number().int().positive().default(24),
  /** Days after delivery before review-request marketing email. */
  REVIEW_REQUEST_DELAY_DAYS: z.coerce.number().int().positive().default(2),
  /** Days after delivery before cashback wallet credit (0 = next scheduler tick after delivery). */
  CASHBACK_CREDIT_DELAY_DAYS: z.coerce.number().int().min(0).default(0),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  /** App version stamped onto bug reports (build-time / deploy env). */
  APP_VERSION: z.string().default('1.0.0'),

  /** When true, orphan cleanup logs candidates but does not delete. */
  S3_ORPHAN_CLEANUP_DRY_RUN: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return false;
      if (typeof v === 'boolean') return v;
      return v === 'true' || v === '1';
    }),

  SENTRY_DSN: z.string().optional(),

  ADMIN_EMAIL: z.string().default('admin@ecommerce.com'),
  ADMIN_PASSWORD: z.string().default('Admin@123'),

  /** Max report date window in days (not a row cap). */
  REPORT_MAX_RANGE_DAYS: z.coerce.number().int().positive().default(366),
  REPORT_EXPORT_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  REPORT_EXPORT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(5),
  REPORT_EXPORT_MAX_PENDING_PER_USER: z.coerce.number().int().positive().default(2),
  /** Dedup window — defaults to artifact TTL (7 days). */
  REPORT_EXPORT_CACHE_TTL_MIN: z.coerce.number().int().positive().default(10_080),
  REPORT_EXPORT_ARTIFACT_TTL_DAYS: z.coerce.number().int().positive().default(7),
  REPORT_EXPORT_CHUNK_SIZE: z.coerce.number().int().positive().default(2000),
  REPORT_EXPORT_STALE_PROCESSING_MIN: z.coerce.number().int().positive().default(30),
  REPORT_EXPORT_PENDING_STALE_MIN: z.coerce.number().int().positive().default(15),
  REPORT_EXPORT_FAILED_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  REPORT_EXPORT_INLINE_DEV: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined) return false;
      if (typeof v === 'boolean') return v;
      return v === 'true' || v === '1';
    }),
}).superRefine((data, ctx) => {
  if (data.MAIL_DRIVER === 'smtp') {
    if (!data.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when MAIL_DRIVER=smtp',
      });
    }
  }

  if (data.MAIL_DRIVER === 'ses') {
    if (!data.AWS_ACCESS_KEY_ID || !data.AWS_SECRET_ACCESS_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AWS_ACCESS_KEY_ID'],
        message: 'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required when MAIL_DRIVER=ses',
      });
    }
  }
});

/** Map legacy EMAIL_TRANSPORT / SES_FROM_EMAIL into the current mail schema. */
function withMailLegacyAliases(raw: NodeJS.ProcessEnv): Record<string, unknown> {
  const transport = raw.EMAIL_TRANSPORT;
  const legacyDriver =
    transport === 'ses' || transport === 'console' || transport === 'auto'
      ? transport
      : undefined;

  return {
    ...raw,
    MAIL_DRIVER: raw.MAIL_DRIVER ?? legacyDriver,
    MAIL_FROM_EMAIL: raw.MAIL_FROM_EMAIL ?? raw.SES_FROM_EMAIL,
  };
}

const parsed = envSchema.safeParse(withMailLegacyAliases(process.env));

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
