import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAgentsTemplateCsv,
  generateAgentsTemplateExcel,
  parseAgentsFile,
  REQUIRED_AGENT_COLUMNS,
} from '../deliveryAgents.template';

describe('deliveryAgents.template', () => {
  it('generates CSV template with headers and sample rows', () => {
    const csv = generateAgentsTemplateCsv();
    assert.ok(csv.includes(REQUIRED_AGENT_COLUMNS.join(',')));
    assert.ok(csv.includes('agent.ramesh@example.com'));
    assert.ok(csv.includes('agent.priya@example.com'));
  });

  it('generates Excel (.xlsx) template that can be parsed back', async () => {
    const buffer = await generateAgentsTemplateExcel();
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 0);

    const mockMulterFile = {
      buffer,
      originalname: 'delivery_agents_template.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    } as Express.Multer.File;

    const rows = await parseAgentsFile(mockMulterFile);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.email, 'agent.ramesh@example.com');
    assert.equal(rows[0]!.fullName, 'Ramesh Kumar');
    assert.equal(rows[0]!.vehicleType, 'BIKE');
    assert.equal(rows[1]!.email, 'agent.priya@example.com');
    assert.equal(rows[1]!.vehicleType, 'SCOOTER');
  });

  it('parses CSV file accurately', async () => {
    const csvContent = `${REQUIRED_AGENT_COLUMNS.join(',')}\ntest@example.com,pass1234,Test Agent,+919999999999,VAN,Central Hub`;
    const mockMulterFile = {
      buffer: Buffer.from(csvContent, 'utf-8'),
      originalname: 'agents.csv',
      mimetype: 'text/csv',
    } as Express.Multer.File;

    const rows = await parseAgentsFile(mockMulterFile);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.email, 'test@example.com');
    assert.equal(rows[0]!.password, 'pass1234');
    assert.equal(rows[0]!.vehicleType, 'VAN');
    assert.equal(rows[0]!.hubOrZone, 'Central Hub');
  });

  it('rejects CSV file missing required columns', async () => {
    const badCsv = 'email,fullName\ntest@example.com,Test Agent';
    const mockMulterFile = {
      buffer: Buffer.from(badCsv, 'utf-8'),
      originalname: 'bad.csv',
      mimetype: 'text/csv',
    } as Express.Multer.File;

    await assert.rejects(
      async () => {
        await parseAgentsFile(mockMulterFile);
      },
      /Missing column\(s\)/,
    );
  });
});
