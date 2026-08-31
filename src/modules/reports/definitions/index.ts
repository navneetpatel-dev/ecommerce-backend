import type { ReportDefinition } from '../engine/types';
import { createOffsetExportQuery, createSingleShotExportQuery } from '../engine/export/createOffsetExportQuery';
import { adminFinanceReports } from './adminFinance';
import { adminOpsReports } from './adminOps';
import { adminCatalogReports } from './adminCatalog';
import { vendorOwnerReports } from './vendorOwner';
import { vendorStaffReports } from './vendorStaff';
import { customerReports } from './customer';
import { reportGapDefinitions } from './reportGaps';
import { legacyPanelReports } from './legacyPanelReports';

export {
  adminFinanceReports,
  adminOpsReports,
  adminCatalogReports,
  vendorOwnerReports,
  vendorStaffReports,
  customerReports,
  reportGapDefinitions,
};

export const ALL_REPORT_DEFINITIONS: ReportDefinition[] = [
  ...adminFinanceReports,
  ...adminOpsReports,
  ...adminCatalogReports,
  ...vendorOwnerReports,
  ...vendorStaffReports,
  ...customerReports,
  ...reportGapDefinitions,
  ...legacyPanelReports,
];
