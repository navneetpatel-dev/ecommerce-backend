/** Ink & Brass print tokens — match the storefront light palette. */
export const PDF_BRAND = {
  name: 'Ink & Brass',
  tagline: 'Multi-seller marketplace',
  currencyPrefix: 'Rs ',
  emptyValue: '--',
  computerGenerated:
    'This is a computer-generated document and does not require a signature.',
} as const;

export const PDF_COLOR = {
  brand: '#8A6A2E',
  brandHover: '#6E5322',
  brandSubtle: '#F3ECDA',
  accent: '#A8432B',
  ink: '#1B1917',
  inkMuted: '#5C5750',
  inkFaint: '#9C968D',
  paper: '#F6F3EC',
  surface: '#FFFFFF',
  line: '#D8D1C2',
  lineStrong: '#C4BAA6',
  success: '#2C4A6B',
  warning: '#9C5A12',
  danger: '#A13A32',
  white: '#FFFFFF',
} as const;

export const PDF_PAGE = {
  margin: 40,
  headerH: 72,
  goldH: 3,
  footerH: 40,
  gutter: 12,
  radius: 3,
  continuedHeaderH: 50,
} as const;

export const PDF_FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
} as const;

/** Horizontal inset inside table cells — keeps values inside shaded rows. */
export const PDF_CELL_PAD = 8;
export const PDF_NUM_FONT_SIZE = 7;
export const PDF_HDR_FONT_SIZE = 6.5;
export const PDF_BODY_FONT_SIZE = 8;
export const PDF_NAME_FONT_SIZE = 8;
