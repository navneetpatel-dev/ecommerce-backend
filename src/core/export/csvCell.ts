/**
 * Text a spreadsheet would run as a formula when the CSV is opened: a cell starting with
 * = + - @ (or a tab / carriage return before one). Vendor-typed text — a business name,
 * a product name, a return reason — reaches admin exports, so `=HYPERLINK(...)` in a
 * shop name would otherwise run in the admin's spreadsheet. A leading quote keeps it text.
 */
export function neutralizeCsvFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** One CSV field: quoted when it holds a comma, quote or line break. */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
