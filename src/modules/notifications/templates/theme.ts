/**
 * Email colours and type, taken from the storefront's design tokens
 * (web/src/shared/styles/globals.css) so mail reads as part of the same shop.
 * Email clients cannot load the site's CSS or Fraunces/Inter reliably, so each font
 * stack names the brand face first and falls back to a safe system equivalent.
 */
export const EMAIL_THEME = {
  light: {
    paper: '#f6f3ec',
    surface: '#ffffff',
    ink: '#1b1917',
    muted: '#5c5750',
    line: '#d8d1c2',
    brand: '#8a6a2e',
    brandSubtle: '#f8f4e9',
    onBrand: '#ffffff',
    danger: '#a13a32',
    dangerSubtle: '#f6e7e4',
    success: '#2c4a6b',
    successSubtle: '#e7ecf1',
  },
  dark: {
    paper: '#121113',
    surface: '#1c1b1d',
    ink: '#f4f1ea',
    muted: '#b7b1a8',
    line: '#5a534c',
    brand: '#d9b25e',
    brandSubtle: '#2e2717',
    onBrand: '#121113',
    danger: '#e2685c',
    dangerSubtle: '#39201d',
    success: '#7fa6c9',
    successSubtle: '#1c2a36',
  },
  fontDisplay: "'Fraunces', Georgia, 'Times New Roman', serif",
  fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  fontMono: "'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace",
} as const;

export type EmailTone = 'info' | 'success' | 'warning' | 'danger';

const L = EMAIL_THEME.light;
const D = EMAIL_THEME.dark;

/**
 * Dark-mode overrides, keyed by the class each element carries. Light values are inline on
 * the elements (the only thing every client honours); these `!important` rules win in clients
 * that support `prefers-color-scheme` (Apple Mail, iOS, Outlook.com, Gmail apps).
 */
export const DARK_MODE_CSS = [
  `.em-bg{background:${D.paper} !important}`,
  `.em-card{background:${D.surface} !important;border-color:${D.line} !important}`,
  `.em-ink{color:${D.ink} !important}`,
  `.em-muted{color:${D.muted} !important}`,
  `.em-brand{color:${D.brand} !important}`,
  `.em-line{border-color:${D.line} !important}`,
  `.em-sub{background:${D.brandSubtle} !important}`,
  `.em-btn{background:${D.brand} !important;color:${D.onBrand} !important}`,
  `.em-btn a{color:${D.onBrand} !important}`,
  `.em-danger{background:${D.dangerSubtle} !important;color:${D.danger} !important}`,
  `.em-success{background:${D.successSubtle} !important;color:${D.success} !important}`,
].join('\n');

export const TONE_STYLE: Record<EmailTone, { bg: string; fg: string; cls: string }> = {
  info: { bg: L.brandSubtle, fg: L.ink, cls: 'em-sub em-ink' },
  success: { bg: L.successSubtle, fg: L.success, cls: 'em-success' },
  warning: { bg: L.brandSubtle, fg: L.brand, cls: 'em-sub em-brand' },
  danger: { bg: L.dangerSubtle, fg: L.danger, cls: 'em-danger' },
};
