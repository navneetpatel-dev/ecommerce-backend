import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { randomUUID } from 'crypto';
import { env } from '@config/env';
import { logger } from '@core/logger';

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional SES configuration set for bounce/complaint tracking. */
  configurationSet?: string;
};

export type SendEmailResult = {
  messageId: string;
  provider: 'ses' | 'console';
};

const hasAwsCredentials = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);

const sesClient = hasAwsCredentials
  ? new SESClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  : null;

export function isSesConfigured(): boolean {
  return Boolean(sesClient);
}

/**
 * Sends email via AWS SES when credentials exist; otherwise logs to console
 * (local/dev) and returns a synthetic message id so the pipeline can complete.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const from = env.SES_FROM_EMAIL;
  const configurationSet = input.configurationSet ?? env.SES_CONFIGURATION_SET;
  const useConsole =
    env.EMAIL_TRANSPORT === 'console' ||
    !sesClient ||
    (env.EMAIL_TRANSPORT === 'auto' && !sesClient);

  if (useConsole) {
    const messageId = `console-${randomUUID()}`;
    logger.info('Email console transport', {
      messageId,
      from,
      to: input.to,
      subject: input.subject,
      textPreview: input.text.slice(0, 240),
    });
    return { messageId, provider: 'console' };
  }

  const result = await sesClient!.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [input.to] },
      Message: {
        Subject: { Data: input.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: input.html, Charset: 'UTF-8' },
          Text: { Data: input.text, Charset: 'UTF-8' },
        },
      },
      ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
    }),
  );

  return {
    messageId: result.MessageId ?? randomUUID(),
    provider: 'ses',
  };
}
