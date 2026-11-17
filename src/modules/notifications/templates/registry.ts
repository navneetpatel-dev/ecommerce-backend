import type { NotificationType } from '@database/models/notificationLog.model';
import { logger } from '@core/logger';
import { EMAIL_COPY, formatEmailCopy } from '../emailCopy';
import {
  bulletList,
  callout,
  codeBox,
  detailsTable,
  inr,
  itemsTable,
  paragraph,
  totalsTable,
  type EmailBlock,
  type EmailItem,
  type EmailRow,
} from './blocks';
import { defaultCta, str, type EmailTemplateData } from './cta';
import { renderEmailLayout } from './layout';
import { emailMeta, MARKETING_TYPES, SECURITY_TYPES } from './meta';
import type { EmailTone } from './theme';

export type { EmailTemplateData };

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export type RenderOptions = { theme?: 'auto' | 'light' | 'dark' };

/** Rupee amounts as the copy writes them after its own "₹": Indian grouping, two decimals. */
function money(data: EmailTemplateData, key: string): string {
  return inr(data[key]).replace(/^₹/, '');
}

function greeting(data: EmailTemplateData): string {
  const name = str(data, 'customerName') || str(data, 'name');
  return name ? formatEmailCopy(EMAIL_COPY.greetings.withName, { name }) : EMAIL_COPY.greetings.anonymous;
}

/** Placeholders whose value may legitimately be empty (they are optional sentence endings). */
const OPTIONAL_VARS = new Set([
  'trackingSuffix', 'businessNameSuffix', 'reason', 'reasonSuffix', 'orderSuffix', 'messageSuffix',
  'expiresSuffix', 'nextStep', 'progressSuffix', 'replyWindow', 'message',
]);

/**
 * Every value a subject or body can name. Scalars from the data are available as-is, so a
 * sender that passes `vendorName` can use `{vendorName}` in the copy; the entries below
 * add money formatting and the optional sentence endings.
 */
function copyVars(data: EmailTemplateData): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of Object.keys(data)) {
    const value = data[key];
    if (value != null && typeof value !== 'object') vars[key] = String(value);
  }
  const orderNumber = str(data, 'orderNumber', str(data, 'orderId'));
  const reason = str(data, 'reason');
  const messageText = str(data, 'message');
  const expiresAt = str(data, 'expiresAt');
  const nextStep = str(data, 'nextStep');
  const progress = str(data, 'progress');
  const businessName = str(data, 'businessName');
  return {
    ...vars,
    brand: EMAIL_COPY.brandName,
    orderNumber,
    total: money(data, 'total'),
    subtotal: money(data, 'subtotal'),
    amount: money(data, 'amount'),
    price: money(data, 'price'),
    expiresInMinutes: str(data, 'expiresInMinutes', '5'),
    statusText: str(data, 'statusText', `updated (${str(data, 'status')})`),
    reason: reason || '—',
    reasonSuffix: reason ? ` (${reason})` : '',
    businessNameSuffix: businessName ? ` for ${businessName}` : '',
    trackingSuffix: str(data, 'trackingId') ? ` (tracking: ${str(data, 'trackingId')})` : '',
    stockList: str(data, 'stockList', `${str(data, 'productName')} (${str(data, 'sku')}): ${str(data, 'stock')} left`),
    slaDays: str(data, 'slaDays', '5–7'),
    orderSuffix: orderNumber ? ` for order #${orderNumber}` : '',
    messageSuffix: messageText ? ` with a message: “${messageText}”` : '',
    expiresSuffix: expiresAt ? ` (by ${expiresAt})` : '',
    nextStep: nextStep ? ` ${nextStep}` : '',
    progressSuffix: progress ? ` ${progress}` : '',
    replyWindow: str(data, 'replyWindow', 'within 1–2 business days'),
    recipientName: str(data, 'recipientName', 'your recipient'),
    purchaserName: str(data, 'purchaserName', 'Someone'),
    inviterName: str(data, 'inviterName', 'A team owner'),
    period: str(data, 'period'),
  };
}

/** Fills a template; if a required value is missing it returns null so the caller can fall back. */
function fill(template: string, vars: Record<string, string>): string | null {
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const key = match[1]!;
    if (!OPTIONAL_VARS.has(key) && !vars[key]) return null;
  }
  return formatEmailCopy(template, vars);
}

function asRows(value: unknown): EmailRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => ({ label: String(row.label ?? ''), value: String(row.value ?? ''), strong: row.strong === true }))
    .filter((row) => row.label && row.value);
}

function asItems(value: unknown): EmailItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      name: String(item.name ?? ''),
      meta: item.meta ? String(item.meta) : undefined,
      quantity: Number(item.quantity ?? 1) || 1,
      price: String(item.price ?? ''),
      imageUrl: item.imageUrl ? String(item.imageUrl) : null,
    }))
    .filter((item) => item.name);
}

/** The rich sections a sender asks for through its data: items, totals, details, code, notes. */
function sectionBlocks(data: EmailTemplateData): EmailBlock[] {
  const blocks: EmailBlock[] = [];
  const note = data.callout as { text?: unknown; tone?: unknown } | undefined;
  if (note && typeof note === 'object' && note.text) {
    blocks.push(callout(String(note.text), (['info', 'success', 'warning', 'danger'].includes(String(note.tone)) ? note.tone : 'info') as EmailTone));
  }
  const code = data.codeBox as { code?: unknown; caption?: unknown } | undefined;
  if (code && typeof code === 'object' && code.code) blocks.push(codeBox(String(code.code), code.caption ? String(code.caption) : undefined));
  const items = asItems(data.items);
  if (items.length) blocks.push(itemsTable(items, str(data, 'itemsTitle', 'Items')));
  const totals = asRows(data.totals);
  if (totals.length) blocks.push(totalsTable(totals));
  const details = asRows(data.details);
  if (details.length) blocks.push(detailsTable(details, str(data, 'detailsTitle') || undefined));
  const bullets = Array.isArray(data.bullets) ? data.bullets.map(String).filter(Boolean) : [];
  if (bullets.length) blocks.push(bulletList(bullets));
  return blocks;
}

export function isMarketingNotification(type: NotificationType): boolean {
  return MARKETING_TYPES.has(type);
}

export function renderNotificationEmail(
  type: NotificationType,
  data: EmailTemplateData,
  options: RenderOptions = {},
): RenderedEmail {
  const vars = copyVars(data);
  const subjectTemplate = EMAIL_COPY.subjects[type] ?? EMAIL_COPY.fallbackSubject;
  const bodyTemplate = EMAIL_COPY.bodies[type] ?? EMAIL_COPY.fallbackBody;
  let subject = fill(subjectTemplate, vars);
  let body = fill(bodyTemplate, vars);
  if (subject === null || body === null) {
    // A sender left out something the copy names; a sentence with a hole reads as a bug.
    logger.warn('Email copy is missing data, using generic wording', { type });
    subject ??= formatEmailCopy(EMAIL_COPY.fallbackSubject, vars);
    body ??= formatEmailCopy(EMAIL_COPY.fallbackBody, vars);
  }

  const cta = defaultCta(type, data);
  const marketing = isMarketingNotification(type);
  const unsubscribeUrl = str(data, 'unsubscribeUrl');
  // The sign-in code is the point of its email: show it large, whether or not the sender built the box.
  const withCode: EmailTemplateData =
    type === 'LOGIN_OTP' && str(data, 'code') && !data.codeBox
      ? { ...data, codeBox: { code: str(data, 'code'), caption: `Expires in ${str(data, 'expiresInMinutes', '5')} minutes · one use only` } }
      : data;
  const blocks = [paragraph(greeting(data)), paragraph(body), ...sectionBlocks(withCode)];

  const rendered = renderEmailLayout({
    preview: body,
    title: subject,
    eyebrow: emailMeta(type).group,
    blocks,
    ctaLabel: str(data, 'ctaLabel') || cta.label,
    ctaUrl: cta.url,
    footerNote: marketing || type === 'NEWSLETTER_WELCOME'
      ? EMAIL_COPY.footerUnsubscribe
      : SECURITY_TYPES.has(type)
        ? EMAIL_COPY.footerSecurity
        : EMAIL_COPY.footerHelp,
    footerLink: (marketing || type === 'NEWSLETTER_WELCOME') && unsubscribeUrl ? { label: EMAIL_COPY.unsubscribeLink, url: unsubscribeUrl } : undefined,
    supportEmail: str(data, 'supportEmail') || undefined,
    supportHours: str(data, 'supportHours') || undefined,
    theme: options.theme,
  });
  return { subject: data.testEmail === true ? `[Test] ${subject}` : subject, ...rendered };
}
