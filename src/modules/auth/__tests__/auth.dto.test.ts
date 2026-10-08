import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ChangePasswordSchema,
  LoginSchema,
  RegisterSchema,
  RequestOtpSchema,
  ResetPasswordSchema,
  VerifyEmailSchema,
  VerifyOtpSchema,
} from '../auth.dto';

describe('auth DTO schemas', () => {
  it('normalizes email case and whitespace at the validation boundary', () => {
    const parsed = RegisterSchema.parse({
      email: '  User@Example.COM  ',
      password: 'longenough1',
      name: 'User',
    });
    assert.equal(parsed.email, 'user@example.com');
  });

  it('rejects emails that are not valid addresses', () => {
    for (const email of ['not-an-email', 'a@', '@b.com', '']) {
      assert.equal(
        LoginSchema.safeParse({ email, password: 'x' }).success,
        false,
        `expected ${JSON.stringify(email)} to be rejected`,
      );
    }
  });

  it('requires at least 8 characters for new passwords (register/reset/change)', () => {
    assert.equal(
      RegisterSchema.safeParse({ email: 'a@b.co', password: '1234567', name: 'N' }).success,
      false,
    );
    assert.equal(
      ResetPasswordSchema.safeParse({ token: 't', newPassword: '1234567' }).success,
      false,
    );
    assert.equal(
      ChangePasswordSchema.safeParse({ currentPassword: 'x', newPassword: '1234567' }).success,
      false,
    );
    assert.equal(
      RegisterSchema.safeParse({ email: 'a@b.co', password: '12345678', name: 'N' }).success,
      true,
    );
  });

  it('requires a name on register but allows omitted phone', () => {
    assert.equal(
      RegisterSchema.safeParse({ email: 'a@b.co', password: '12345678', name: '' }).success,
      false,
    );
    const parsed = RegisterSchema.parse({ email: 'a@b.co', password: '12345678', name: 'N' });
    assert.equal(parsed.phone, undefined);
  });

  it('OTP verification requires a 6-digit code (inheriting the email rules)', () => {
    assert.equal(VerifyOtpSchema.safeParse({ email: 'a@b.co', code: '123456' }).success, true);
    for (const code of ['12345', '1234567', 'abcdef', '12 456']) {
      assert.equal(
        VerifyOtpSchema.safeParse({ email: 'a@b.co', code }).success,
        false,
        `expected code ${JSON.stringify(code)} to be rejected`,
      );
    }
  });

  it('OTP request normalizes the email like the other entry points', () => {
    const parsed = RequestOtpSchema.parse({ email: ' Person@Mail.IO ' });
    assert.equal(parsed.email, 'person@mail.io');
  });

  it('verify-email rejects an empty token', () => {
    assert.equal(VerifyEmailSchema.safeParse({ token: '' }).success, false);
    assert.equal(VerifyEmailSchema.safeParse({ token: 'abc' }).success, true);
  });
});
