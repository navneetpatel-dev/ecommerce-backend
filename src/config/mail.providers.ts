import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { randomUUID } from 'crypto';
import nodemailer from 'nodemailer';
import { env } from '@config/env';
import { logger } from '@core/logger';
import type { MailMessage, MailProvider, MailSendResult } from './mail';

export function formatMailFrom(message: MailMessage): string {
  const email = message.from ?? env.MAIL_FROM_EMAIL;
  const name = env.MAIL_FROM_NAME;
  return name ? `${name} <${email}>` : email;
}

export function createConsoleMailProvider(): MailProvider {
  return {
    name: 'console',
    isReady: () => true,
    async send(message): Promise<MailSendResult> {
      const messageId = `console-${randomUUID()}`;
      logger.info('Email console transport', {
        messageId,
        from: formatMailFrom(message),
        to: message.to,
        subject: message.subject,
        textPreview: message.text.slice(0, 240),
      });
      return { messageId, provider: 'console' };
    },
  };
}

export function createSesMailProvider(): MailProvider {
  const hasCredentials = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
  const client = hasCredentials
    ? new SESClient({
        region: env.AWS_REGION,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
        },
      })
    : null;

  return {
    name: 'ses',
    isReady: () => Boolean(client),
    async send(message): Promise<MailSendResult> {
      if (!client) {
        throw new Error('SES mail provider is not configured (missing AWS credentials)');
      }

      const configurationSet =
        (typeof message.meta?.configurationSet === 'string'
          ? message.meta.configurationSet
          : undefined) ?? env.SES_CONFIGURATION_SET;

      const result = await client.send(
        new SendEmailCommand({
          Source: formatMailFrom(message),
          Destination: { ToAddresses: [message.to] },
          Message: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
          },
          ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
          ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
        }),
      );

      return {
        messageId: result.MessageId ?? randomUUID(),
        provider: 'ses',
      };
    },
  };
}

export function createSmtpMailProvider(): MailProvider {
  const host = env.SMTP_HOST?.trim();
  const transporter = host
    ? nodemailer.createTransport({
        host,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth:
          env.SMTP_USER && env.SMTP_PASS
            ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
            : undefined,
      })
    : null;

  return {
    name: 'smtp',
    isReady: () => Boolean(transporter),
    async send(message): Promise<MailSendResult> {
      if (!transporter) {
        throw new Error('SMTP mail provider is not configured (missing SMTP_HOST)');
      }

      const info = await transporter.sendMail({
        from: formatMailFrom(message),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });

      return {
        messageId: info.messageId || randomUUID(),
        provider: 'smtp',
      };
    },
  };
}
