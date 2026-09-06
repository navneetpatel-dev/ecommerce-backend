import assert from 'node:assert/strict';
import { describe, it, mock, afterEach } from 'node:test';
import { ROLES } from '@core/constants/statuses';
import { User } from '@database/models/user.model';
import { reportEngine } from '@modules/reports/engine/reportEngine';
import { settingsService } from '@modules/settings/settings.service';
import { runScheduledWeeklyReports } from '@jobs/scheduledReports.processor';

// Monday, matching the default scheduledReportsDayOfWeek(1) / scheduledReportsHourUtc(6).
const MATCHING_MONDAY_6AM_UTC = new Date(Date.UTC(2024, 0, 1, 6));

function mockSettings(overrides: Partial<Awaited<ReturnType<typeof settingsService.getPlatformSettings>>> = {}) {
  return mock.method(settingsService, 'getPlatformSettings', async () => ({
    scheduledReportsEnabled: true,
    scheduledReportsTypes: ['reconciliation', 'gmv-sales'],
    scheduledReportsRecipients: [] as string[],
    scheduledReportsDayOfWeek: 1,
    scheduledReportsHourUtc: 6,
    ...overrides,
  } as Awaited<ReturnType<typeof settingsService.getPlatformSettings>>));
}

describe('runScheduledWeeklyReports', () => {
  afterEach(() => mock.restoreAll());

  it('generates reports and emails attachments to super admins', async () => {
    mockSettings();
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

    const sent = await runScheduledWeeklyReports({
      sendMail: sendMailMock,
      now: MATCHING_MONDAY_6AM_UTC,
    });

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
    mockSettings();
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

    const sent = await runScheduledWeeklyReports({
      sendMail: sendMailMock,
      now: MATCHING_MONDAY_6AM_UTC,
    });
    assert.equal(sent, 0);
    assert.equal(exportMock.mock.callCount(), 0);
    assert.equal(sendMailMock.mock.callCount(), 0);
  });

  it('does nothing when disabled in settings', async () => {
    mockSettings({ scheduledReportsEnabled: false });
    const findAllMock = mock.method(User, 'findAll', async () => []);

    const sent = await runScheduledWeeklyReports({ now: MATCHING_MONDAY_6AM_UTC });

    assert.equal(sent, 0);
    assert.equal(findAllMock.mock.callCount(), 0);
  });

  it('does nothing when now does not match the configured cadence', async () => {
    mockSettings();
    const findAllMock = mock.method(User, 'findAll', async () => []);
    const notMonday = new Date(Date.UTC(2024, 0, 2, 6)); // Tuesday

    const sent = await runScheduledWeeklyReports({ now: notMonday });

    assert.equal(sent, 0);
    assert.equal(findAllMock.mock.callCount(), 0);
  });

  it('emails only the explicit recipient list when configured', async () => {
    mockSettings({ scheduledReportsRecipients: ['ops@example.com'] });
    const findAllMock = mock.method(User, 'findAll', async () => [
      { id: 'user-1', email: 'ops@example.com', vendorId: null } as User,
    ]);
    mock.method(reportEngine, 'runExportDirect', async (_actor, reportType) => ({
      buffer: Buffer.from(`report:${reportType}`),
      filename: `${reportType}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      rowCount: 1,
    }));
    const sendMailMock = mock.fn(async () => ({ messageId: 'test-id', provider: 'console' }));

    const sent = await runScheduledWeeklyReports({
      sendMail: sendMailMock,
      now: MATCHING_MONDAY_6AM_UTC,
    });

    assert.equal(sent, 2);
    const whereArg = findAllMock.mock.calls[0]?.arguments[0] as { where: { email: string[] } };
    assert.deepEqual(whereArg.where.email, ['ops@example.com']);
  });
});
