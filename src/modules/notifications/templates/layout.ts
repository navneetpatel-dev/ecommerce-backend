import { EMAIL_COPY } from '../emailCopy';
import { escapeHtml, type EmailBlock } from './blocks';
import { DARK_MODE_CSS, EMAIL_THEME as T } from './theme';

export { escapeHtml };

export type EmailLayoutParams = {
  /** Inbox preview text. */
  preview: string;
  /** The heading inside the card. */
  title: string;
  /** Small uppercase label above the heading (e.g. "Your order"). */
  eyebrow?: string;
  /** Pre-built content blocks, in order. */
  blocks?: EmailBlock[];
  /** Legacy: raw body HTML, for callers that build their own markup. */
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
  /** A link under the footer note (the unsubscribe link on marketing mail). */
  footerLink?: { label: string; url: string };
  supportEmail?: string;
  supportHours?: string;
  /** `auto` follows the reader's setting; `dark`/`light` force one (admin preview). */
  theme?: 'auto' | 'light' | 'dark';
};

const L = T.light;

function button(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 6px"><tr><td class="em-btn" style="background:${L.brand};border-radius:8px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 24px;font-family:${T.fontSans};font-size:15px;font-weight:600;color:${L.onBrand};text-decoration:none">${escapeHtml(label)}</a></td></tr></table>`;
}

function darkCss(theme: 'auto' | 'light' | 'dark'): string {
  if (theme === 'light') return '';
  return theme === 'dark' ? DARK_MODE_CSS : `@media (prefers-color-scheme: dark){${DARK_MODE_CSS}}`;
}

export function renderEmailLayout(params: EmailLayoutParams): { html: string; text: string } {
  const brand = escapeHtml(EMAIL_COPY.brandName);
  const theme = params.theme ?? 'auto';
  const blocks = params.blocks ?? [];
  const content = params.bodyHtml ?? blocks.map((block) => block.html).join('');
  const footerNote = escapeHtml(params.footerNote ?? EMAIL_COPY.footerHelp);
  const footerLink = params.footerLink
    ? ` <a class="em-muted" href="${escapeHtml(params.footerLink.url)}" style="color:${L.muted};text-decoration:underline">${escapeHtml(params.footerLink.label)}</a>`
    : '';
  const support = params.supportEmail
    ? `<div style="padding-bottom:6px">Need help? <a class="em-brand" href="mailto:${escapeHtml(params.supportEmail)}" style="color:${L.brand};text-decoration:none">${escapeHtml(params.supportEmail)}</a>${params.supportHours ? ` · ${escapeHtml(params.supportHours)}` : ''}</div>`
    : '';
  const eyebrow = params.eyebrow
    ? `<div class="em-brand" style="font-family:${T.fontSans};font-size:11px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600;color:${L.brand};padding-bottom:6px">${escapeHtml(params.eyebrow)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  <title>${escapeHtml(params.title)}</title>
  <style>${darkCss(theme)}</style>
</head>
<body class="em-bg" style="margin:0;padding:0;background:${L.paper};font-family:${T.fontSans};color:${L.ink}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(params.preview)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="em-bg" style="background:${L.paper};padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:580px" cellspacing="0" cellpadding="0">
        <tr><td style="padding:0 4px 14px"><span class="em-brand" style="font-family:${T.fontDisplay};font-size:26px;font-weight:600;letter-spacing:-0.3px;color:${L.brand}">${brand}</span></td></tr>
        <tr><td class="em-card" style="background:${L.surface};border:1px solid ${L.line};border-radius:12px;padding:30px 28px">
          ${eyebrow}
          <h1 class="em-ink" style="margin:0 0 16px;font-family:${T.fontDisplay};font-size:24px;line-height:1.25;font-weight:600;color:${L.ink}">${escapeHtml(params.title)}</h1>
          <div style="font-family:${T.fontSans}">${content}</div>
          ${params.ctaLabel && params.ctaUrl ? button(params.ctaLabel, params.ctaUrl) : ''}
        </td></tr>
        <tr><td class="em-muted" style="padding:18px 8px 0;font-family:${T.fontSans};font-size:12px;line-height:1.6;color:${L.muted};text-align:center">${support}<div>${footerNote}${footerLink}</div><div style="padding-top:6px">&copy; ${new Date().getFullYear()} ${brand}</div></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textParts = [
    `${EMAIL_COPY.brandName}`,
    params.title,
    ...blocks.map((block) => block.text),
    params.ctaUrl ? `${params.ctaLabel ?? 'Open'}: ${params.ctaUrl}` : '',
    params.supportEmail ? `Need help? ${params.supportEmail}${params.supportHours ? ` (${params.supportHours})` : ''}` : '',
    params.footerNote ?? EMAIL_COPY.footerHelp,
    params.footerLink ? `${params.footerLink.label}: ${params.footerLink.url}` : '',
  ].filter(Boolean);
  // Legacy callers that pass only bodyHtml and a preview keep their preview in the text part.
  if (!blocks.length && params.bodyHtml) textParts.splice(2, 0, params.preview);

  return { html, text: textParts.join('\n\n') };
}
