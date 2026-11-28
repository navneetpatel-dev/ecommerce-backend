import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

/**
 * SMTP (nodemailer) is the only way this backend sends email. These checks fail if another email
 * service, SDK, driver switch or provider webhook is added back, so "only SMTP" stays true.
 */
const root = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'logs', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Names of other email services / their SDKs / the settings that selected them.
const OTHER_MAIL_SERVICES = new RegExp(
  [
    'client-ses',
    'client-sesv2',
    'client-sns',
    'SESClient',
    'SendEmailCommand',
    'SendRawEmailCommand',
    'sendgrid',
    'mailgun',
    'postmark',
    'mandrill',
    'sparkpost',
    'brevo',
    'sendinblue',
    'mailchimp',
    'mailtrap',
    'ethereal',
    'MAIL_DRIVER',
    'mail_driver',
    'EMAIL_TRANSPORT',
    '\\bSES_[A-Z_]+',
    'mail\\.providers',
    'createSesMailProvider',
    'createConsoleMailProvider',
    'processSesWebhook',
    'handleSesEvent',
  ].join('|'),
  'i',
);
const AMAZON_SES_WORD = /\bSES\b|\bSNS\b|Amazon SES|AWS SES/;

const THIS_FILE = path.relative(root, __filename);
// Tests that assert the old endpoints / settings are gone have to name them.
const ALLOWED_TO_NAME_THEM = new Set([
  path.join('src', 'modules', 'webhooks', '__tests__', 'webhooksHttp.test.ts'),
  path.join('src', 'config', '__tests__', 'mail.test.ts'), // proves the legacy variables are ignored
  THIS_FILE,
]);

describe('only SMTP exists', () => {
  it('package.json depends on nodemailer and on no other email SDK', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.ok(names.includes('nodemailer'));
    const offenders = names.filter((n) => OTHER_MAIL_SERVICES.test(n) || /^@aws-sdk\/client-(ses|sesv2|sns)/.test(n) || /^nodemailer-/.test(n));
    assert.deepEqual(offenders, []);
    assert.ok(names.includes('@aws-sdk/client-s3'), 'S3 storage is not email and must stay');
  });

  it('the lockfile no longer contains the SES SDK', () => {
    const lock = read('package-lock.json');
    assert.doesNotMatch(lock, /@aws-sdk\/client-(ses|sesv2|sns)\b/);
  });

  it('no source, script, migration or seeder names another email service', () => {
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts')), ...walk(path.join(root, 'database'))].filter((f) =>
      /\.(ts|js|cjs|mjs|json)$/.test(f),
    );
    const hits: string[] = [];
    for (const file of files) {
      const rel = path.relative(root, file);
      if (ALLOWED_TO_NAME_THEM.has(rel)) continue;
      const text = fs.readFileSync(file, 'utf8');
      const m = OTHER_MAIL_SERVICES.exec(text) ?? AMAZON_SES_WORD.exec(text);
      if (m) hits.push(`${rel}: ${m[0]}`);
    }
    assert.deepEqual(hits, []);
  });

  it('config templates and docs describe SMTP only', () => {
    const docs = ['.env.example', 'README.md', 'docs/DEPLOYMENT.md', 'docs/archive/implementation.md'];
    const hits: string[] = [];
    for (const file of docs) {
      const m = OTHER_MAIL_SERVICES.exec(read(file)) ?? AMAZON_SES_WORD.exec(read(file));
      if (m) hits.push(`${file}: ${m[0]}`);
    }
    assert.deepEqual(hits, []);
    assert.match(read('.env.example'), /^SMTP_HOST=/m);
    assert.match(read('README.md'), /Email:\*\* SMTP/);
  });

  it('the backend does not expose a provider webhook route or error code for another email service', () => {
    const routes = read('src/modules/webhooks/webhooks.routes.ts');
    assert.match(routes, /\/razorpay/);
    assert.doesNotMatch(routes, /'\/(ses|sns|sendgrid|mailgun|postmark)/);
    assert.doesNotMatch(read('src/core/constants/errorMessages.ts'), /SNS_|SES_/);
  });
});
