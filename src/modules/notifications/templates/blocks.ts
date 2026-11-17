import { EMAIL_THEME as T, TONE_STYLE, type EmailTone } from './theme';

const L = T.light;

export type EmailBlock = { html: string; text: string };

export type EmailItem = {
  name: string;
  /** Variant or seller line under the name, e.g. "Size M · Sold by TechWorld". */
  meta?: string;
  quantity: number;
  /** Line total, already formatted (₹1,299.00). */
  price: string;
  imageUrl?: string | null;
};

export type EmailRow = { label: string; value: string; strong?: boolean };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const multiline = (value: string) => escapeHtml(value).replace(/\n/g, '<br>');

/** Rupees as shoppers read them: ₹4,495.39 (Indian grouping, two decimals). */
export function inr(value: unknown): string {
  const amount = Number(value);
  if (value == null || value === '' || !Number.isFinite(amount)) return '';
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function paragraph(value: string): EmailBlock {
  return {
    html: `<p class="em-ink" style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${L.ink}">${multiline(value)}</p>`,
    text: value,
  };
}

export function callout(value: string, tone: EmailTone = 'info'): EmailBlock {
  const style = TONE_STYLE[tone];
  return {
    html: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 16px"><tr><td class="${style.cls}" style="background:${style.bg};color:${style.fg};border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.55">${multiline(value)}</td></tr></table>`,
    text: value,
  };
}

/** A short code (sign-in code, coupon code) shown large and easy to copy. */
export function codeBox(code: string, caption?: string): EmailBlock {
  return {
    html: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 18px"><tr><td align="center" class="em-sub" style="background:${L.brandSubtle};border-radius:10px;padding:18px 12px"><div class="em-brand" style="font-family:${T.fontMono};font-size:30px;letter-spacing:6px;font-weight:600;color:${L.brand}">${escapeHtml(code)}</div>${caption ? `<div class="em-muted" style="font-size:12px;color:${L.muted};padding-top:8px">${escapeHtml(caption)}</div>` : ''}</td></tr></table>`,
    text: caption ? `${code}\n(${caption})` : code,
  };
}

export function detailsTable(rows: EmailRow[], title?: string): EmailBlock {
  const body = rows
    .map(
      (row) =>
        `<tr><td class="em-muted" style="padding:7px 12px 7px 0;font-size:13px;color:${L.muted};vertical-align:top;width:38%">${escapeHtml(row.label)}</td><td class="em-ink" style="padding:7px 0;font-size:14px;color:${L.ink};${row.strong ? 'font-weight:600;' : ''}">${multiline(row.value)}</td></tr>`,
    )
    .join('');
  const heading = title
    ? `<div class="em-brand" style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${L.brand};font-weight:600;padding-bottom:4px">${escapeHtml(title)}</div>`
    : '';
  return {
    html: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="em-line" style="margin:6px 0 16px;border-top:1px solid ${L.line};border-bottom:1px solid ${L.line}"><tr><td style="padding:10px 0">${heading}<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${body}</table></td></tr></table>`,
    text: `${title ? `${title}\n` : ''}${rows.map((row) => `${row.label}: ${row.value}`).join('\n')}`,
  };
}

export function bulletList(lines: string[]): EmailBlock {
  const items = lines
    .map((line) => `<li class="em-ink" style="margin:0 0 6px;color:${L.ink}">${escapeHtml(line)}</li>`)
    .join('');
  return {
    html: `<ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.55">${items}</ul>`,
    text: lines.map((line) => `- ${line}`).join('\n'),
  };
}

export function itemsTable(items: EmailItem[], title = 'Items'): EmailBlock {
  const anyImage = items.some((item) => item.imageUrl);
  const rows = items
    .map((item) => {
      const image = item.imageUrl
        ? `<img src="${escapeHtml(item.imageUrl)}" alt="" width="52" height="52" style="display:block;width:52px;height:52px;object-fit:cover;border-radius:6px;border:1px solid ${L.line}">`
        : '';
      const thumb = anyImage ? `<td style="padding:10px 12px 10px 0;width:64px;vertical-align:top">${image}</td>` : '';
      return `<tr>${thumb}<td style="padding:10px 8px 10px 0;vertical-align:top"><div class="em-ink" style="font-size:14px;font-weight:600;color:${L.ink}">${escapeHtml(item.name)}</div>${item.meta ? `<div class="em-muted" style="font-size:12px;color:${L.muted};padding-top:2px">${escapeHtml(item.meta)}</div>` : ''}<div class="em-muted" style="font-size:12px;color:${L.muted};padding-top:2px">Qty ${item.quantity}</div></td><td class="em-ink" align="right" style="padding:10px 0;font-size:14px;color:${L.ink};vertical-align:top;white-space:nowrap">${escapeHtml(item.price)}</td></tr>`;
    })
    .join('');
  return {
    html: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="em-line" style="margin:6px 0 4px;border-top:1px solid ${L.line}"><tr><td colspan="${anyImage ? 3 : 2}" class="em-brand" style="padding:10px 0 0;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${L.brand};font-weight:600">${escapeHtml(title)}</td></tr>${rows}</table>`,
    text: `${title}\n${items.map((item) => `- ${item.name}${item.meta ? ` (${item.meta})` : ''} × ${item.quantity}: ${item.price}`).join('\n')}`,
  };
}

export function totalsTable(rows: EmailRow[]): EmailBlock {
  const body = rows
    .map(
      (row) =>
        `<tr><td class="${row.strong ? 'em-ink' : 'em-muted'}" style="padding:4px 0;font-size:${row.strong ? 15 : 13}px;color:${row.strong ? L.ink : L.muted};${row.strong ? 'font-weight:700;' : ''}">${escapeHtml(row.label)}</td><td class="${row.strong ? 'em-ink' : 'em-muted'}" align="right" style="padding:4px 0;font-size:${row.strong ? 15 : 13}px;color:${row.strong ? L.ink : L.muted};${row.strong ? 'font-weight:700;' : ''}">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('');
  return {
    html: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="em-line" style="margin:0 0 16px;border-top:1px solid ${L.line}"><tr><td style="padding-top:8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${body}</table></td></tr></table>`,
    text: rows.map((row) => `${row.label}: ${row.value}`).join('\n'),
  };
}
