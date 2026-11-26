import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it, mock } from 'node:test';
import nodemailer from 'nodemailer';
import { env } from '@config/env';
import * as mail from '@config/mail';

const { formatMailFrom, isMailConfigured, resetMailTransport, sendEmail } = mail;

const message = {
  to: 'customer@gmail.com',
  subject: 'Your order',
  html: '<p>Thanks</p>',
  text: 'Thanks',
};

/** Replaces nodemailer's transport factory so no connection is ever opened. */
function fakeTransport(result: { messageId?: string } = { messageId: '<abc@smtp>' }) {
  const sendMail = mock.fn(async (_options: unknown) => result);
  const createTransport = mock.method(nodemailer, 'createTransport', (() => ({ sendMail })) as never);
  return { sendMail, createTransport };
}

describe('mail: SMTP is the only transport', () => {
  afterEach(() => {
    mock.restoreAll();
    resetMailTransport();
  });

  it('exposes only SMTP-era API: no provider registry, no other drivers', () => {
    assert.deepEqual(
      Object.keys(mail).sort(),
      ['MailNotConfiguredError', 'formatMailFrom', 'isMailConfigured', 'resetMailTransport', 'sendEmail'].sort(),
    );
  });

  it('is configured exactly when SMTP_HOST is set', () => {
    assert.equal(isMailConfigured(), Boolean(env.SMTP_HOST?.trim()));
  });

  it('sends through an SMTP transport built from the SMTP_* settings and reports provider "smtp"', async (t) => {
    if (!isMailConfigured()) return t.skip('SMTP_HOST is not set in this environment');
    const { sendMail, createTransport } = fakeTransport();

    const result = await sendEmail(message);

    assert.deepEqual(result, { messageId: '<abc@smtp>', provider: 'smtp' });
    assert.equal(createTransport.mock.callCount(), 1);
    const options = createTransport.mock.calls[0]!.arguments[0] as Record<string, unknown>;
    assert.equal(options.host, env.SMTP_HOST?.trim());
    assert.equal(options.port, env.SMTP_PORT);
    assert.equal(options.secure, env.SMTP_SECURE);
    assert.equal(options.pool, true);
    assert.equal(options.rateLimit, env.MAIL_RATE_PER_MINUTE);
    assert.equal('streamTransport' in options, false);

    const sent = sendMail.mock.calls[0]!.arguments[0] as Record<string, unknown>;
    assert.equal(sent.from, formatMailFrom(message));
    assert.equal(sent.to, message.to);
    assert.equal(sent.subject, message.subject);
    assert.equal(sent.html, message.html);
    assert.equal(sent.text, message.text);
    assert.equal('attachments' in sent, false);
  });

  it('reuses one transport across sends and rebuilds it after a reset', async (t) => {
    if (!isMailConfigured()) return t.skip('SMTP_HOST is not set in this environment');
    const { createTransport } = fakeTransport();
    await sendEmail(message);
    await sendEmail(message);
    assert.equal(createTransport.mock.callCount(), 1);
    resetMailTransport();
    await sendEmail(message);
    assert.equal(createTransport.mock.callCount(), 2);
  });

  it('passes reply-to, MIME headers (List-Unsubscribe) and attachments through', async (t) => {
    if (!isMailConfigured()) return t.skip('SMTP_HOST is not set in this environment');
    const { sendMail } = fakeTransport();
    await sendEmail({
      ...message,
      from: 'support@shop.example',
      replyTo: 'help@shop.example',
      headers: { 'List-Unsubscribe': '<https://shop.example/u/1>' },
      attachments: [{ filename: 'invoice.pdf', content: Buffer.from('%PDF'), contentType: 'application/pdf' }],
    });
    const sent = sendMail.mock.calls[0]!.arguments[0] as Record<string, unknown>;
    assert.equal(sent.replyTo, 'help@shop.example');
    assert.deepEqual(sent.headers, { 'List-Unsubscribe': '<https://shop.example/u/1>' });
    assert.match(String(sent.from), /support@shop\.example/);
    assert.deepEqual(sent.attachments, [
      { filename: 'invoice.pdf', content: Buffer.from('%PDF'), contentType: 'application/pdf' },
    ]);
  });

  it('falls back to a generated id when the server returns none', async (t) => {
    if (!isMailConfigured()) return t.skip('SMTP_HOST is not set in this environment');
    fakeTransport({});
    const result = await sendEmail(message);
    assert.equal(result.provider, 'smtp');
    assert.ok(result.messageId.length > 10);
  });

  it('lets SMTP errors reach the caller untouched so delivery can classify them', async (t) => {
    if (!isMailConfigured()) return t.skip('SMTP_HOST is not set in this environment');
    const boom = Object.assign(new Error('535 Username and Password not accepted'), { code: 'EAUTH', responseCode: 535 });
    mock.method(nodemailer, 'createTransport', (() => ({ sendMail: async () => { throw boom; } })) as never);
    await assert.rejects(sendEmail(message), (e) => e === boom);
  });
});

/** Runs a snippet in a fresh process with a controlled environment (the env object is frozen at import). */
function runWith(extraEnv: Record<string, string | undefined>, code: string) {
  const cwd = path.resolve(__dirname, '../../..');
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '-e', code],
    {
      cwd,
      env: { ...process.env, TSX_TSCONFIG_PATH: path.join(cwd, 'tsconfig.json'), ...extraEnv },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
}

describe('mail: behaviour without SMTP_HOST (fresh process)', () => {
  const snippet = `
    (async () => {
      const mail = require('./src/config/mail');
      console.log('CONFIGURED=' + mail.isMailConfigured());
      try { await mail.sendEmail({ to: 'a@gmail.com', subject: 's', html: 'h', text: 't' }); console.log('SENT'); }
      catch (e) { console.log('ERR=' + e.name + '|' + e.code + '|' + e.message); }
      process.exit(0);
    })();`;

  it('is not configured and refuses to send with a clear, classifiable error', () => {
    const r = runWith({ SMTP_HOST: '' }, snippet);
    assert.match(r.stdout, /CONFIGURED=false/, r.stderr);
    assert.match(r.stdout, /ERR=MailNotConfiguredError\|ESMTPNOTCONFIGURED\|SMTP is not configured/);
    assert.doesNotMatch(r.stdout, /SENT/);
  });
});

describe('env: no other mail service can be selected or configured (fresh process)', () => {
  const dump = `const { env } = require('./src/config/env'); console.log('KEYS=' + JSON.stringify(Object.keys(env)));`;

  it('ignores leftover MAIL_DRIVER / SES_* / EMAIL_TRANSPORT variables: they have no effect', () => {
    const r = runWith(
      {
        MAIL_DRIVER: 'ses',
        EMAIL_TRANSPORT: 'ses',
        SES_CONFIGURATION_SET: 'cfg',
        SES_SNS_TOPIC_ARN: 'arn:aws:sns:x:1:t',
        SES_FROM_EMAIL: 'old@example.com',
      },
      dump,
    );
    assert.equal(r.status, 0, r.stderr);
    const keys = JSON.parse(/KEYS=(.*)/.exec(r.stdout)![1]!) as string[];
    for (const gone of ['MAIL_DRIVER', 'EMAIL_TRANSPORT', 'SES_CONFIGURATION_SET', 'SES_SNS_TOPIC_ARN', 'SES_FROM_EMAIL']) {
      assert.equal(keys.includes(gone), false, `${gone} must not be part of the config`);
    }
    for (const kept of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM_EMAIL', 'AWS_REGION', 'S3_BUCKET']) {
      assert.equal(keys.includes(kept), true, `${kept} must remain`);
    }
  });

  it('does not let the old SES_FROM_EMAIL alias set the sender', () => {
    const r = runWith(
      { SES_FROM_EMAIL: 'old@example.com', MAIL_FROM_EMAIL: undefined },
      `const { env } = require('./src/config/env'); console.log('FROM=' + env.MAIL_FROM_EMAIL);`,
    );
    // dotenv may supply MAIL_FROM_EMAIL; either way it must never be the legacy alias.
    assert.doesNotMatch(r.stdout, /FROM=old@example\.com/);
  });
});

describe('env: production requires SMTP (fresh process)', () => {
  const cwd = path.resolve(__dirname, '../../..');
  const dotenvFile = path.join(cwd, '.env');
  const boot = `const { env } = require('./src/config/env'); console.log('BOOTED smtp=' + Boolean(env.SMTP_HOST));`;

  // dotenv is not loaded in production, so feed the same values the dev setup uses.
  function production(over: Record<string, string>) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const base = (require('dotenv') as typeof import('dotenv')).parse(fs.readFileSync(dotenvFile));
    return spawnSync(process.execPath, ['--import', 'tsx', '-e', boot], {
      cwd,
      env: { PATH: process.env.PATH, TSX_TSCONFIG_PATH: path.join(cwd, 'tsconfig.json'), ...base, NODE_ENV: 'production', ...over },
      encoding: 'utf8',
      timeout: 60_000,
    });
  }

  it('boots with SMTP_HOST set', (t) => {
    if (!fs.existsSync(dotenvFile)) return t.skip('no .env to borrow the other required settings from');
    const r = production({ SMTP_HOST: 'smtp.example.org' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /BOOTED smtp=true/);
  });

  it('refuses to boot without SMTP_HOST (empty or blank), naming only that setting', (t) => {
    if (!fs.existsSync(dotenvFile)) return t.skip('no .env to borrow the other required settings from');
    for (const blank of ['', '   ']) {
      const r = production({ SMTP_HOST: blank });
      assert.notEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /SMTP_HOST is required in production/);
    }
  });
});
