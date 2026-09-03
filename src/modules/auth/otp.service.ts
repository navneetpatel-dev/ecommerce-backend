import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { Op, type Transaction } from 'sequelize';
import { sequelize } from '@database/models';
import { OtpCode } from '@database/models/otpCode.model';
import type { OtpPurpose } from '@database/models/otpCode.model';
import { USER_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { ValidationError } from '@core/errors';
import { notificationsService } from '@modules/notifications/notifications.service';
import { authRepository } from './auth.repository';

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;

export type OtpVerificationResult =
  | { valid: true }
  | { valid: false; message: string };

function generateNumericCode(): string {
  const upperBound = 10 ** OTP_CODE_LENGTH;
  return String(crypto.randomInt(0, upperBound)).padStart(OTP_CODE_LENGTH, '0');
}

export class OtpService {
  async issueCodeForUser(
    userId: string,
    purpose: OtpPurpose,
    transaction?: Transaction,
  ): Promise<{ id: string; code: string }> {
    const code = generateNumericCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
    await OtpCode.update(
      { consumedAt: new Date() },
      { where: { userId, purpose, consumedAt: { [Op.is]: null } }, transaction },
    );
    const otp = await OtpCode.create(
      { userId, purpose, codeHash, expiresAt, attempts: 0 },
      { transaction },
    );
    return { id: otp.id, code };
  }

  async verifyCodeForUser(
    userId: string,
    purpose: OtpPurpose,
    code: string,
    transaction: Transaction,
  ): Promise<OtpVerificationResult> {
    const otp = await OtpCode.findOne({
      where: { userId, purpose, consumedAt: { [Op.is]: null } },
      order: [['createdAt', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!otp || otp.expiresAt.getTime() <= Date.now()) {
      return { valid: false, message: ERROR_MESSAGES.OTP_INVALID_OR_EXPIRED };
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      return { valid: false, message: ERROR_MESSAGES.OTP_TOO_MANY_ATTEMPTS };
    }
    if (!(await bcrypt.compare(code, otp.codeHash))) {
      await otp.update({ attempts: otp.attempts + 1 }, { transaction });
      return { valid: false, message: ERROR_MESSAGES.OTP_INVALID_OR_EXPIRED };
    }
    await otp.update({ consumedAt: new Date() }, { transaction });
    return { valid: true };
  }

  async requestLoginCode(email: string): Promise<void> {
    const user = await authRepository.findByEmail(email);
    if (!user || user.status === USER_STATUS.BLOCKED) {
      throw new ValidationError({ email: [ERROR_MESSAGES.OTP_EMAIL_NOT_REGISTERED] });
    }

    const otp = await sequelize.transaction((transaction) =>
      this.issueCodeForUser(user.id, 'LOGIN', transaction),
    );

    await notificationsService.sendLoginOtp(user.id, otp.id, {
      code: otp.code,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
  }

  async verifyLoginCode(email: string, code: string) {
    const result = await sequelize.transaction(async (transaction) => {
      const user = await authRepository.findByEmail(email);
      if (!user || user.status === USER_STATUS.BLOCKED) {
        return {
          user: null,
          verification: {
            valid: false,
            message: ERROR_MESSAGES.OTP_INVALID_OR_EXPIRED,
          } as OtpVerificationResult,
        };
      }

      const verification = await this.verifyCodeForUser(
        user.id,
        'LOGIN',
        code,
        transaction,
      );
      return { user, verification };
    });

    if (!result.verification.valid) {
      throw new ValidationError({ code: [result.verification.message] });
    }
    if (!result.user) {
      throw new ValidationError({ code: [ERROR_MESSAGES.OTP_INVALID_OR_EXPIRED] });
    }
    return result.user;
  }
}

export const otpService = new OtpService();
