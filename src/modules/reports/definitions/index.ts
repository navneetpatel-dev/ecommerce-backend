import type { ReportDefinition } from '../engine/types';
import { adminFinanceReports } from './adminFinance';
import { adminOpsReports } from './adminOps';
import { adminCatalogReports } from './adminCatalog';
import { vendorOwnerReports } from './vendorOwner';
import { customerReports } from './customer';
import { reportGapDefinitions } from './reportGaps';
import { legacyPanelReports } from './legacyPanelReports';

export {
  adminFinanceReports,
  adminOpsReports,
  adminCatalogReports,
  vendorOwnerReports,
  customerReports,
  reportGapDefinitions,
};

export const ALL_REPORT_DEFINITIONS: ReportDefinition[] = [
  ...adminFinanceReports,
  ...adminOpsReports,
  ...adminCatalogReports,
  ...vendorOwnerReports,
  ...customerReports,
  ...reportGapDefinitions,
  ...legacyPanelReports,
];
