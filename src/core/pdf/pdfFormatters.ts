import { coerceRupees, roundMoney as roundMoneyValue, toPaise } from '@modules/pricing/money';

export { roundMoneyValue as roundMoney };

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

/** Indian grouping: 291769.74 -> 2,91,769.74 */
export function formatInrAmount(amount: unknown): string {
  const n = roundMoneyValue(amount);
  const [wholeRaw, frac = '00'] = n.toFixed(2).split('.');
  const whole = wholeRaw ?? '0';
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '');
  if (digits.length <= 3) return `${sign}${digits}.${frac}`;
  const last3 = digits.slice(-3);
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${head},${last3}.${frac}`;
}

export function formatPdfMoney(amount: unknown, prefix = 'Rs '): string {
  return `${prefix}${formatInrAmount(amount)}`;
}

export function formatPrintDate(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

function underThousand(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return [TENS[tens], ONES[ones]].filter(Boolean).join(' ');
}

function underThousandWithHundred(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(underThousand(rest));
  return parts.join(' ');
}

/** Indian-system amount in words for printed invoices. */
export function rupeesInWords(amount: unknown): string {
  const paiseTotal = toPaise(roundMoneyValue(amount));
  const abs = Math.abs(paiseTotal);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';

  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const rest = rupees % 1_000;
  const parts: string[] = [];
  if (crore) parts.push(`${underThousandWithHundred(crore)} Crore`);
  if (lakh) parts.push(`${underThousandWithHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${underThousandWithHundred(thousand)} Thousand`);
  if (rest) parts.push(underThousandWithHundred(rest));

  let phrase = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  if (paise) phrase += ` and ${underThousand(paise)} Paise`;
  if (paiseTotal < 0) phrase = `Negative ${phrase}`;
  return `${phrase} Only`;
}

/** Safe cell string for tabular PDF exports. */
export function formatPdfCellValue(value: unknown, empty = '--'): string {
  if (value == null) return empty;
  if (value instanceof Date) return formatPrintDate(value);
  if (typeof value === 'number' || typeof value === 'string') {
    const trimmed = typeof value === 'string' ? value.trim() : value;
    if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
      const n = coerceRupees(trimmed);
      return Number.isInteger(n) ? String(n) : formatInrAmount(n);
    }
  }
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 512);
  const raw = String(value).replace(/\s+/g, ' ').trim();
  if (!raw) return empty;
  return raw.length > 512 ? `${raw.slice(0, 509)}...` : raw;
}
