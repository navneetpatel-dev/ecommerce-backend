import { get, loginAs } from '../lib/httpClient';
import { CREDENTIALS } from '../lib/testData';
import { assertTrue, assertEqual } from '../lib/assert';

export type Preconditions = {
  adminToken: string;
  tcsRatePercent: number;
  deliveryAgentPerTaskEarning: number;
  testRunStartedAt: string;
};

export async function runPreconditions(): Promise<Preconditions> {
  const scenario = '00-preconditions';

  const health = await get('/health');
  assertEqual(scenario, 'server healthy', health.status, 200);

  const adminToken = await loginAs(CREDENTIALS.superAdmin.email, CREDENTIALS.superAdmin.password);
  assertTrue(scenario, 'super admin login', Boolean(adminToken));

  const settingsRes = await get('/api/settings', adminToken);
  assertEqual(scenario, 'settings fetch', settingsRes.status, 200);
  const settings = settingsRes.json?.data ?? {};
  const tcsRatePercent = Number(settings.tcsRatePercent ?? 1);
  const deliveryAgentPerTaskEarning = Number(settings.deliveryAgentPerTaskEarning ?? 20);
  console.log(`  settings: tcsRatePercent=${tcsRatePercent} deliveryAgentPerTaskEarning=${deliveryAgentPerTaskEarning}`);

  return {
    adminToken,
    tcsRatePercent,
    deliveryAgentPerTaskEarning,
    testRunStartedAt: new Date(Date.now() - 5000).toISOString(),
  };
}
