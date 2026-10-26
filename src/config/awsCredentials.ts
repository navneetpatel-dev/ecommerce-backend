import { env } from './env';

export type AwsClientConfig = {
  region: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
};

/**
 * Shared S3/SES client config, or null when AWS is not configured.
 *
 * - Static keys (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY) win when both are set.
 * - Otherwise, with AWS_USE_DEFAULT_CREDENTIALS=true, the SDK's default provider
 *   chain is used — on ECS that is the task role, so no long-lived keys exist.
 */
export function awsClientConfig(): AwsClientConfig | null {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    return {
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    };
  }
  if (env.AWS_USE_DEFAULT_CREDENTIALS) return { region: env.AWS_REGION };
  return null;
}
