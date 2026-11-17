import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maskBankDetails, validateBankDetailsChange } from '../vendorBankDetails';

const GOOD = { accountHolderName: 'Acme', bankName: 'HDFC', accountNumber: '123456789012', ifscCode: 'hdfc0001234' };

describe('validateBankDetailsChange', () => {
  it('accepts a well-formed new account and upper-cases the IFSC', () => {
    const result = validateBankDetailsChange(GOOD, null);
    assert.equal(result.ifscCode, 'HDFC0001234');
  });

  it('rejects a changed account with a malformed number or IFSC', () => {
    assert.throws(() => validateBankDetailsChange({ ...GOOD, accountNumber: '12ab' }, null), /9 to 18 digits/);
    assert.throws(() => validateBankDetailsChange({ ...GOOD, ifscCode: 'SBIN000000' }, null), /IFSC/);
  });

  it('leaves older, unchanged details alone so unrelated settings still save', () => {
    const legacy = { bankName: 'SBI', accountNumber: '000000000000000', ifscCode: 'SBIN000000' };
    assert.deepEqual(validateBankDetailsChange({ ...legacy }, { ...legacy }), legacy);
  });

  it('accepts empty details (registration without a bank yet)', () => {
    assert.deepEqual(validateBankDetailsChange({}, null), {});
  });
});

describe('maskBankDetails', () => {
  it('hides all but the last four digits of the account number', () => {
    const masked = maskBankDetails({ id: 'v1', bankDetails: { ...GOOD } });
    assert.equal((masked.bankDetails as { accountNumber: string }).accountNumber, '••••9012');
    assert.equal((masked.bankDetails as { bankName: string }).bankName, 'HDFC');
  });

  it('leaves a vendor without an account number untouched', () => {
    const vendor = { id: 'v1', bankDetails: {} };
    assert.equal(maskBankDetails(vendor), vendor);
  });
});
