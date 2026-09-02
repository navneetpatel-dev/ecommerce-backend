import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isReportExportOnS3,
  reportExportUsesLocal,
  reportExportUsesS3,
} from './reportExportStorage';

describe('reportExportStorage', () => {
  it('detects S3-stored exports from fileUrl or slash-separated fileKey', () => {
    assert.equal(isReportExportOnS3({ fileUrl: 'https://bucket.s3.amazonaws.com/a/b.pdf' }), true);
    assert.equal(isReportExportOnS3({ fileKey: 'reports/user/export.pdf' }), true);
    assert.equal(isReportExportOnS3({ fileKey: 'reports_user_export.pdf' }), false);
    assert.equal(isReportExportOnS3({ fileKey: null, fileUrl: null }), false);
  });

  it('exposes a single active backend (local or s3)', () => {
    assert.equal(reportExportUsesS3(), !reportExportUsesLocal());
  });
});
