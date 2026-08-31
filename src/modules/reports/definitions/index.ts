import type { ReportDefinition } from '../engine/types';
import { adminFinanceReports } from './adminFinance';
import { adminOpsReports } from './adminOps';
import { adminCatalogReports } from './adminCatalog';
import { vendorOwnerReports } from './vendorOwner';
import { vendorStaffReports } from './vendorStaff';
import { customerReports } from './customer';
import { reportGapDefinitions } from './reportGaps';

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
];
