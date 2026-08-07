import { EMAIL_COPY } from '../emailCopy';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderEmailLayout(params: {
  preview: string;
  title: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}): { html: string; text: string } {
  const brand = escapeHtml(EMAIL_COPY.brandName);
  const preview = escapeHtml(params.preview);
  const title = escapeHtml(params.title);
  const cta =
    params.ctaLabel && params.ctaUrl
      ? `<p style="margin:24px 0"><a href="${escapeHtml(params.ctaUrl)}" style="background:#111;color:#fff;padding:12px 18px;text-decoration:none;border-radius:4px;display:inline-block">${escapeHtml(params.ctaLabel)}</a></p>`
      : '';
  const footer = escapeHtml(params.footerNote ?? EMAIL_COPY.footerHelp);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#18181b">
  <div style="display:none;max-height:0;overflow:hidden">${preview}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:32px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:28px">
          <tr><td style="font-size:18px;font-weight:700;padding-bottom:16px">${brand}</td></tr>
          <tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${title}</td></tr>
          <tr><td style="font-size:15px;line-height:1.55">${params.bodyHtml}</td></tr>
          <tr><td>${cta}</td></tr>
          <tr><td style="font-size:12px;color:#71717a;padding-top:24px;border-top:1px solid #e4e4e7">${footer}</td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textParts = [
    EMAIL_COPY.brandName,
    params.title,
    params.preview,
    params.ctaUrl ? `${params.ctaLabel ?? ''}: ${params.ctaUrl}` : '',
    params.footerNote ?? EMAIL_COPY.footerHelp,
  ].filter(Boolean);

  return { html, text: textParts.join('\n\n') };
}
