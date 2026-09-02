import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { ROLES } from '@core/constants/statuses';
import { User } from '@database/models/user.model';
import { reportEngine } from '@modules/reports/engine/reportEngine';
import { runScheduledWeeklyReports } from '@jobs/scheduledReports.processor';

describe('runScheduledWeeklyReports', () => {
  afterEach(() => mock.restoreAll());

  it('generates reports and emails attachments to super admins', async () => {
    const admin = {
      id: 'admin-1',
      email: 'admin@example.com',
      vendorId: null,
    } as User;

    mock.method(User, 'findAll', async () => [admin]);
    const exportMock = mock.method(reportEngine, 'runExportDirect', async (_actor, reportType) => ({
      buffer: Buffer.from(`report:${reportType}`),
      filename: `${reportType}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      rowCount: 1,
    }));
    const sendMailMock = mock.fn(async () => ({
      messageId: 'test-id',
      provider: 'console',
    }));

    const sent = await runScheduledWeeklyReports({ sendMail: sendMailMock });

    assert.equal(sent, 2);
    assert.equal(exportMock.mock.callCount(), 2);
    assert.equal(sendMailMock.mock.callCount(), 2);
    const firstCall = sendMailMock.mock.calls[0]?.arguments[0] as {
      to: string;
      attachments?: Array<{ filename: string }>;
    };
    assert.equal(firstCall.to, 'admin@example.com');
    assert.ok(firstCall.attachments?.[0]?.filename.endsWith('.xlsx'));
  });

  it('skips admins without email addresses', async () => {
    mock.method(User, 'findAll', async () => [
      { id: 'admin-1', email: null, vendorId: null, roleName: ROLES.SUPER_ADMIN } as User,
    ]);
    const exportMock = mock.method(reportEngine, 'runExportDirect', async () => {
      throw new Error('should not generate when no recipients');
    });
    const sendMailMock = mock.fn(async () => ({
      messageId: 'test-id',
      provider: 'console',
    }));

    const sent = await runScheduledWeeklyReports({ sendMail: sendMailMock });
    assert.equal(sent, 0);
    assert.equal(exportMock.mock.callCount(), 0);
    assert.equal(sendMailMock.mock.callCount(), 0);
  });
});
