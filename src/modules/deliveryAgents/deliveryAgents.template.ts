import ExcelJS from 'exceljs';
import { ValidationError } from '@core/errors/ValidationError';
import type { CreateDeliveryAgentRequest } from './deliveryAgents.dto';

export const REQUIRED_AGENT_COLUMNS = [
  'email',
  'password',
  'fullName',
  'phone',
  'vehicleType',
  'hubOrZone',
] as const;

export const MAX_BULK_IMPORT_ROWS = 200;
export const MAX_BULK_IMPORT_BYTES = 2 * 1024 * 1024; // 2MB

export const SAMPLE_AGENT_ROWS = [
  {
    email: 'agent.ramesh@example.com',
    password: 'Password@123',
    fullName: 'Ramesh Kumar',
    phone: '+919876543210',
    vehicleType: 'BIKE',
    hubOrZone: 'North Hub',
  },
  {
    email: 'agent.priya@example.com',
    password: 'Password@123',
    fullName: 'Priya Sharma',
    phone: '+919876543211',
    vehicleType: 'SCOOTER',
    hubOrZone: 'South Hub',
  },
];

/**
 * Builds an Excel (.xlsx) buffer with styled headers, guidance, and sample data.
 */
export async function generateAgentsTemplateExcel(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ecommerce-platform';
  const sheet = workbook.addWorksheet('Delivery Agents');

  sheet.columns = [
    { header: 'email', key: 'email', width: 28 },
    { header: 'password', key: 'password', width: 20 },
    { header: 'fullName', key: 'fullName', width: 24 },
    { header: 'phone', key: 'phone', width: 20 },
    { header: 'vehicleType', key: 'vehicleType', width: 16 },
    { header: 'hubOrZone', key: 'hubOrZone', width: 20 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 24;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const sample of SAMPLE_AGENT_ROWS) {
    const row = sheet.addRow(sample);
    row.height = 20;
    row.alignment = { vertical: 'middle' };
  }

  const rawBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(rawBuffer);
}

/**
 * Generates a clean CSV template string with headers and sample rows.
 */
export function generateAgentsTemplateCsv(): string {
  const header = REQUIRED_AGENT_COLUMNS.join(',');
  const lines = SAMPLE_AGENT_ROWS.map(
    (r) => `${r.email},${r.password},${r.fullName},${r.phone},${r.vehicleType},${r.hubOrZone}`,
  );
  return [header, ...lines].join('\n');
}

/**
 * Parses either an Excel (.xlsx) or CSV file into CreateDeliveryAgentRequest rows.
 */
export async function parseAgentsFile(
  file: Express.Multer.File,
): Promise<CreateDeliveryAgentRequest[]> {
  const isXlsx =
    file.originalname.endsWith('.xlsx') ||
    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (isXlsx) {
    return parseAgentsXlsx(file.buffer);
  }
  return parseAgentsCsv(file.buffer.toString('utf-8'));
}

async function parseAgentsXlsx(buffer: Buffer): Promise<CreateDeliveryAgentRequest[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new ValidationError('Could not read Excel file. Please ensure it is a valid .xlsx file.');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new ValidationError('Excel file contains no worksheets.');
  }

  const headerRow = sheet.getRow(1);
  const colIndexToKey: Record<number, string> = {};
  headerRow.eachCell((cell, colNumber) => {
    const rawVal = String(cell.value ?? '').trim();
    if (rawVal) {
      colIndexToKey[colNumber] = rawVal;
    }
  });

  const foundHeaders = Object.values(colIndexToKey);
  const missing = REQUIRED_AGENT_COLUMNS.filter((col) => !foundHeaders.includes(col));
  if (missing.length > 0) {
    throw new ValidationError(`Missing required column(s) in Excel sheet: ${missing.join(', ')}`);
  }

  const rows: CreateDeliveryAgentRequest[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const record: Record<string, string> = {};
    let hasAnyValue = false;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = colIndexToKey[colNumber];
      if (key) {
        let val = '';
        if (cell.value != null) {
          if (typeof cell.value === 'object' && 'text' in cell.value) {
            val = String((cell.value as { text?: string }).text ?? '').trim();
          } else {
            val = String(cell.value).trim();
          }
        }
        if (val) hasAnyValue = true;
        record[key] = val;
      }
    });

    if (hasAnyValue) {
      rows.push({
        email: record.email || '',
        password: record.password || '',
        fullName: record.fullName || '',
        phone: record.phone || '',
        vehicleType: (record.vehicleType as 'BIKE' | 'SCOOTER' | 'VAN' | 'BICYCLE') || 'BIKE',
        hubOrZone: record.hubOrZone || '',
      });
    }
  });

  if (rows.length === 0) {
    throw new ValidationError('Excel file contains no data rows.');
  }
  if (rows.length > MAX_BULK_IMPORT_ROWS) {
    throw new ValidationError(
      `File exceeds maximum limit of ${MAX_BULK_IMPORT_ROWS} rows (found ${rows.length} rows).`,
    );
  }

  return rows;
}

function parseAgentsCsv(text: string): CreateDeliveryAgentRequest[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new ValidationError('CSV must have a header row and at least one data row.');
  }

  const firstLine = lines[0] ?? '';
  const header = firstLine.split(',').map((cell) => cell.trim());
  const missing = REQUIRED_AGENT_COLUMNS.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    throw new ValidationError(`Missing column(s): ${missing.join(', ')}`);
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_BULK_IMPORT_ROWS) {
    throw new ValidationError(
      `CSV file exceeds maximum limit of ${MAX_BULK_IMPORT_ROWS} rows (found ${dataLines.length} rows).`,
    );
  }

  return dataLines.map((line) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const record: Record<string, string> = {};
    header.forEach((col, index) => {
      record[col] = cells[index] ?? '';
    });
    return {
      email: record.email || '',
      password: record.password || '',
      fullName: record.fullName || '',
      phone: record.phone || '',
      vehicleType: (record.vehicleType as 'BIKE' | 'SCOOTER' | 'VAN' | 'BICYCLE') || 'BIKE',
      hubOrZone: record.hubOrZone || '',
    };
  });
}
