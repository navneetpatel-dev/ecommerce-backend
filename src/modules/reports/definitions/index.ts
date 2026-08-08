import type { ReportDefinition } from '../engine/types';
import { adminFinanceReports } from './adminFinance';
import { adminOpsReports } from './adminOps';
import { adminCatalogReports } from './adminCatalog';
import { vendorOwnerReports } from './vendorOwner';
import { vendorStaffReports } from './vendorStaff';
import { customerReports } from './customer';

export {
  adminFinanceReports,
  adminOpsReports,
  adminCatalogReports,
  vendorOwnerReports,
  vendorStaffReports,
  customerReports,
};

export const ALL_REPORT_DEFINITIONS: ReportDefinition[] = [
  ...adminFinanceReports,
  ...adminOpsReports,
  ...adminCatalogReports,
  ...vendorOwnerReports,
  ...vendorStaffReports,
  ...customerReports,
];
