import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '@config/env';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { sequelize } from '@database/models';
import { authRepository as repo } from './auth.repository';
import { AuthTokens, JwtPayload } from './auth.types';
import { RegisterRequest, LoginRequest } from './auth.dto';
import { AppError, NotFoundError, ValidationError, ForbiddenError } from '@core/errors';
import { logger } from '@core/logger';
import { clearPermissionCache, resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { redisClient, withRedis } from '@config/redis';
import { EMAIL_VERIFY_EXPIRY, PASSWORD_RESET_EXPIRY, REFRESH_TOKEN_TTL_MS } from '@core/constants/http';
import { ROLES, USER_STATUS } from '@core/constants/statuses';
import { ERROR_MESSAGES, ERROR_CODES } from '@core/constants/errors';
import { roleNameOf } from '@utils/userRole';
import { notificationsService } from '@modules/notifications/notifications.service';
import { otpService } from './otp.service';

export type SessionDeviceMeta = {
  userAgent?: string | null;
  ipAddress?: string | null;
  family?: string;
};

export type AuthUserPayload = {
  id: string;
  email: string;
  name: string;
  role: string;
  vendorId: string | null;
  deliveryAgentId: string | null;
  permissions: string[];
};

export type LoginSuccess = {
  user: AuthUserPayload;
  accessToken: string;
  refreshToken: string;
};

/**
 * Registration no longer issues a session (Rule: unverified accounts cannot
 * log in, so there's nothing valid to hand back yet) — just enough for the
 * UI to show "check your email" with the right name/address.
 */
export type RegisterResult = {
  user: { id: string; email: string; name: string };
  requiresVerification: true;
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRY } as jwt.SignOptions);
}

async function generateRefreshToken(userId: string, meta: SessionDeviceMeta = {}): Promise<string> {
  const raw = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashToken(raw);
  const family = meta.family ?? crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await repo.createRefreshToken({
    userId,
    tokenHash,
    expiresAt,
    family,
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ipAddress ?? null,
    lastUsedAt: new Date(),
  });

  return raw;
}

function toUserPayload(user: User): JwtPayload {
  return {
    sub: user.id,
    email: user.email,
    roleId: user.roleId,
    vendorId: user.vendorId,
    deliveryAgentId: user.deliveryAgentId,
    roleName: roleNameOf(user),
  };
}

const REFRESH_GRACE_PREFIX = 'auth:refresh-grace:';
const REFRESH_GRACE_SEC = 30;

async function markRefreshGrace(tokenHash: string, family: string): Promise<void> {
  await withRedis(() =>
    redisClient.setex(`${REFRESH_GRACE_PREFIX}${tokenHash}`, REFRESH_GRACE_SEC, family),
  );
}

async function readRefreshGraceFamily(tokenHash: string): Promise<string | null> {
  return withRedis(() => redisClient.get(`${REFRESH_GRACE_PREFIX}${tokenHash}`));
}

async function generateTokens(user: User, meta: SessionDeviceMeta = {}): Promise<AuthTokens> {
  const accessToken = generateAccessToken(toUserPayload(user));
  const refreshToken = await generateRefreshToken(user.id, meta);
  return { accessToken, refreshToken };
}

function emailVerifyActionUrl(userId: string): string {
  const verifyToken = jwt.sign(
    { sub: userId, purpose: 'email-verify' },
    env.JWT_SECRET,
    { expiresIn: EMAIL_VERIFY_EXPIRY },
  );
  return `${env.CLIENT_URL.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verifyToken)}`;
}

function serializeSession(
  token: {
    family: string;
    userAgent: string | null;
    ipAddress: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    updatedAt: Date;
  },
  currentFamily: string | null,
) {
  return {
    id: token.family,
    family: token.family,
    userAgent: token.userAgent,
    ipAddress: token.ipAddress,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt ?? token.updatedAt ?? token.createdAt,
    isCurrent: Boolean(currentFamily && token.family === currentFamily),
  };
}

export class AuthService {
  async register(dto: RegisterRequest): Promise<RegisterResult> {
    const existing = await repo.findByEmailIncludingDeleted(dto.email);

    if (existing && !existing.deletedAt) {
      throw new ValidationError({ email: [ERROR_MESSAGES.EMAIL_ALREADY_REGISTERED] });
    }

    if (existing?.deletedAt) {
      return this.reactivateDeletedAccount(existing, dto);
    }

    const customerRole = await Role.findOne({ where: { name: ROLES.CUSTOMER } });
    if (!customerRole) {
      throw new AppError('Default role not found', 500, ERROR_CODES.CONFIG_ERROR);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await User.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
      phone: dto.phone ?? null,
      status: USER_STATUS.ACTIVE,
      roleId: customerRole.id,
      vendorId: null,
      emailVerified: false,
      emailMarketingConsent: false,
      emailSuppressed: false,
      avatarUrl: null,
    });

    void notificationsService.sendEmailVerification(user.id, {
      actionUrl: emailVerifyActionUrl(user.id),
    });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      requiresVerification: true,
    };
  }

  /**
   * Soft-deleted email registering again → restore the same row (keep role/vendor),
   * set a new password, drop old sessions, require re-verification. Blocked
   * accounts stay blocked.
   */
  private async reactivateDeletedAccount(
    deleted: User,
    dto: RegisterRequest,
  ): Promise<RegisterResult> {
    if (deleted.status === USER_STATUS.BLOCKED) {
      throw new ForbiddenError(ERROR_MESSAGES.ACCOUNT_BLOCKED);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await sequelize.transaction(async (t) => {
      await deleted.restore({ transaction: t });
      await deleted.update(
        {
          passwordHash,
          name: dto.name,
          phone: dto.phone !== undefined ? dto.phone : deleted.phone,
          status: USER_STATUS.ACTIVE,
          emailVerified: false,
          deletedBy: null,
        } as any,
        { transaction: t },
      );
      await repo.deleteRefreshTokensByUser(deleted.id);
    });

    const user = await repo.findByEmail(dto.email);
    if (!user) {
      throw new AppError(ERROR_MESSAGES.INTERNAL_ERROR, 500, ERROR_CODES.INTERNAL_ERROR);
    }

    logger.info('Reactivated soft-deleted account on register', {
      userId: user.id,
      email: user.email,
      role: roleNameOf(user),
    });

    void notificationsService.sendEmailVerification(user.id, {
      actionUrl: emailVerifyActionUrl(user.id),
    });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      requiresVerification: true,
    };
  }

  async login(dto: LoginRequest, meta: SessionDeviceMeta = {}): Promise<LoginSuccess> {
    const user = await repo.findByEmail(dto.email);
    if (!user) {
      // Deliberately NOT field-keyed (unlike most ValidationErrors here): this
      // fires for both "no such account" and "wrong password", and keying it
      // to `email` would let an attacker distinguish which one was wrong by
      // watching which field lights up. Same generic message, same status,
      // same (lack of a) field either way — rendered as one form-level notice.
      throw new AppError(ERROR_MESSAGES.INVALID_CREDENTIALS, 422, ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (user.status === USER_STATUS.BLOCKED) {
      throw new ForbiddenError(ERROR_MESSAGES.ACCOUNT_BLOCKED);
    }

    if (!user.emailVerified) {
      throw new AppError(ERROR_MESSAGES.EMAIL_NOT_VERIFIED, 403, ERROR_CODES.EMAIL_NOT_VERIFIED);
    }

    if (!user.passwordHash) {
      throw new ValidationError({ email: [ERROR_MESSAGES.OAUTH_PASSWORD_ACCOUNT] });
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      // Deliberately NOT field-keyed (unlike most ValidationErrors here): this
      // fires for both "no such account" and "wrong password", and keying it
      // to `email` would let an attacker distinguish which one was wrong by
      // watching which field lights up. Same generic message, same status,
      // same (lack of a) field either way — rendered as one form-level notice.
      throw new AppError(ERROR_MESSAGES.INVALID_CREDENTIALS, 422, ERROR_CODES.INVALID_CREDENTIALS);
    }

    return this.issueSession(user, meta);
  }

  async requestLoginOtp(email: string): Promise<void> {
    await otpService.requestLoginCode(email);
  }

  async loginWithOtp(email: string, code: string, meta: SessionDeviceMeta = {}): Promise<LoginSuccess> {
    const user = await otpService.verifyLoginCode(email, code);
    return this.issueSession(user, meta);
  }

  /** Used by Google OAuth after resolving the user row. */
  async issueSessionFromUser(user: User, meta: SessionDeviceMeta = {}): Promise<LoginSuccess> {
    return this.issueSession(user, meta);
  }

  private async issueSession(user: User, meta: SessionDeviceMeta): Promise<LoginSuccess> {
    const tokens = await generateTokens(user, meta);
    const roleName = roleNameOf(user);
    const permissions = await resolvePermissionsForUser({
      roleId: user.roleId,
      role: { name: roleName },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: roleName,
        vendorId: user.vendorId,
        deliveryAgentId: user.deliveryAgentId,
        permissions,
      },
      ...tokens,
    };
  }

  async refreshToken(rawToken: string, meta: SessionDeviceMeta = {}) {
    const tokenHash = hashToken(rawToken);
    let token = await repo.findRefreshToken(tokenHash);

    if (!token) {
      const graceFamily = await readRefreshGraceFamily(tokenHash);
      if (graceFamily) {
        token = await repo.findLatestRefreshTokenByFamily(graceFamily);
      }
    }

    if (!token) {
      throw new AppError(ERROR_MESSAGES.INVALID_TOKEN, 401, ERROR_CODES.INVALID_REFRESH_TOKEN);
    }

    if (token.expiresAt < new Date()) {
      throw new AppError('Refresh token expired', 401, ERROR_CODES.REFRESH_TOKEN_EXPIRED);
    }

    await markRefreshGrace(tokenHash, token.family);
    await repo.deleteRefreshToken(tokenHash);

    const user = await User.findByPk(token.userId, {
      include: [{ model: Role, as: 'role' }],
    });
    if (!user || user.status === USER_STATUS.BLOCKED) {
      throw new AppError(ERROR_MESSAGES.USER_NOT_FOUND_OR_BLOCKED, 401, ERROR_CODES.UNAUTHORIZED);
    }

    return generateTokens(user, {
      family: token.family,
      userAgent: meta.userAgent ?? token.userAgent,
      ipAddress: meta.ipAddress ?? token.ipAddress,
    });
  }

  async logout(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    await repo.deleteRefreshToken(tokenHash);
  }

  async listSessions(userId: string, currentRawToken?: string | null) {
    const tokens = await repo.listRefreshTokensByUser(userId);
    let currentFamily: string | null = null;
    if (currentRawToken) {
      const current = await repo.findRefreshToken(hashToken(currentRawToken));
      currentFamily = current?.family ?? null;
    }

    const byFamily = new Map<string, (typeof tokens)[number]>();
    for (const token of tokens) {
      if (!byFamily.has(token.family)) {
        byFamily.set(token.family, token);
      }
    }

    return [...byFamily.values()].map((token) => serializeSession(token, currentFamily));
  }

  async revokeSession(userId: string, family: string) {
    await repo.deleteRefreshTokensByFamily(userId, family);
  }

  async revokeOtherSessions(userId: string, currentRawToken: string) {
    const current = await repo.findRefreshToken(hashToken(currentRawToken));
    if (!current || current.userId !== userId) {
      throw new ValidationError({ session: ['Current session not found'] });
    }
    await repo.deleteRefreshTokensExceptFamily(userId, current.family);
  }

  async forgotPassword(email: string) {
    const user = await repo.findByEmail(email);
    if (!user) {
      logger.info('Password reset requested for unknown email', { email });
      return;
    }

    if (user.status === USER_STATUS.BLOCKED) {
      logger.info('Password reset requested for blocked account', { email });
      return;
    }

    const token = jwt.sign(
      { sub: user.id, purpose: 'password-reset' },
      env.JWT_SECRET,
      { expiresIn: PASSWORD_RESET_EXPIRY },
    );
    const actionUrl = `${env.CLIENT_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    void notificationsService.sendPasswordReset(user.id, { actionUrl });
    logger.info('Password reset requested', { email: user.email, role: roleNameOf(user) });
  }

  /**
   * Click-only by design: the signed, time-limited token IS the proof of
   * mailbox ownership — it doesn't need an active session behind it too.
   * Someone can (and often will) verify from a different device/browser
   * than the one they registered on.
   */
  async verifyEmail(token: string): Promise<{ verified: boolean }> {
    let decoded: { sub: string; purpose: string };
    try {
      decoded = jwt.verify(token, env.JWT_SECRET) as { sub: string; purpose: string };
    } catch {
      throw new ValidationError({ token: ['Invalid or expired verification token'] });
    }
    if (decoded.purpose !== 'email-verify') {
      throw new ValidationError({ token: ['Invalid token purpose'] });
    }

    const user = await repo.findById(decoded.sub);
    if (!user) throw new NotFoundError('User');

    if (!user.emailVerified) {
      await repo.update(user.id, { emailVerified: true } as any);
      void notificationsService.sendWelcome(user.id, { name: user.name });
    }

    return { verified: true };
  }

  async resendEmailVerification(userId: string): Promise<{ sent: boolean; alreadyVerified: boolean }> {
    const user = await repo.findById(userId);
    if (!user) throw new NotFoundError('User');

    if (user.emailVerified) {
      return { sent: false, alreadyVerified: true };
    }

    void notificationsService.sendEmailVerification(user.id, {
      actionUrl: emailVerifyActionUrl(user.id),
    });
    return { sent: true, alreadyVerified: false };
  }

  /**
   * Unauthenticated counterpart of `resendEmailVerification` — a user who
   * can't log in yet (email not verified) has no session to call the
   * authenticated version with, so they need an email-only path to get a
   * fresh link.
   */
  async resendEmailVerificationByEmail(email: string): Promise<{ sent: boolean; alreadyVerified: boolean }> {
    const user = await repo.findByEmail(email);
    if (!user || user.status === USER_STATUS.BLOCKED) {
      throw new ValidationError({ email: [ERROR_MESSAGES.OTP_EMAIL_NOT_REGISTERED] });
    }

    if (user.emailVerified) {
      return { sent: false, alreadyVerified: true };
    }

    void notificationsService.sendEmailVerification(user.id, {
      actionUrl: emailVerifyActionUrl(user.id),
    });
    return { sent: true, alreadyVerified: false };
  }

  async resetPassword(resetToken: string, newPassword: string) {
    let decoded: { sub: string; purpose: string };
    try {
      decoded = jwt.verify(resetToken, env.JWT_SECRET) as { sub: string; purpose: string };
    } catch {
      throw new ValidationError({ token: ['Invalid or expired reset token'] });
    }

    if (decoded.purpose !== 'password-reset') {
      throw new ValidationError({ token: ['Invalid token purpose'] });
    }

    const user = await repo.findById(decoded.sub);
    if (!user) {
      throw new NotFoundError('User');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await repo.update(user.id, { passwordHash } as any);
    await repo.deleteRefreshTokensByUser(user.id);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await repo.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    if (!user.passwordHash) {
      throw new ValidationError({ currentPassword: [ERROR_MESSAGES.OAUTH_PASSWORD_ACCOUNT] });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new ValidationError({ currentPassword: ['Current password is incorrect'] });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await repo.update(userId, { passwordHash } as any);
    await repo.deleteRefreshTokensByUser(userId);
  }
}

export const authService = new AuthService();
