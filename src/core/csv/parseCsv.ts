/**
 * RFC 4180 CSV: fields may be quoted, and a quoted field may hold commas, line breaks and doubled
 * quotes (""). A leading byte-order mark (Excel adds one) is ignored. Returns the rows of cells,
 * leaving out blank lines.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (char === ',') endCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      endRow();
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}
