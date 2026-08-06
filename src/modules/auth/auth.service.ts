import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '@config/env';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { authRepository as repo } from './auth.repository';
import { AuthTokens, JwtPayload } from './auth.types';
import { RegisterRequest, LoginRequest } from './auth.dto';
import { AppError, NotFoundError, ValidationError, ForbiddenError } from '@core/errors';
import { logger } from '@core/logger';
import { clearPermissionCache, resolvePermissionsForUser } from '@middleware/rbac.middleware';

export type SessionDeviceMeta = {
  userAgent?: string | null;
  ipAddress?: string | null;
  family?: string;
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
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
  };
}

async function generateTokens(user: User, meta: SessionDeviceMeta = {}): Promise<AuthTokens> {
  const accessToken = generateAccessToken(toUserPayload(user));
  const refreshToken = await generateRefreshToken(user.id, meta);
  return { accessToken, refreshToken };
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
  async register(
    dto: RegisterRequest,
    meta: SessionDeviceMeta = {},
  ): Promise<{ user: { id: string; email: string; name: string; role: string; vendorId: string | null; permissions: string[] }; accessToken: string; refreshToken: string }> {
    const existing = await repo.findByEmail(dto.email);
    if (existing) {
      throw new ValidationError({ email: ['Email already registered'] });
    }

    const customerRole = await Role.findOne({ where: { name: 'CUSTOMER' } });
    if (!customerRole) {
      throw new AppError('Default role not found', 500, 'CONFIG_ERROR');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await User.create({
      email: dto.email,
      passwordHash,
      name: dto.name,
      phone: dto.phone ?? null,
      status: 'ACTIVE' as const,
      roleId: customerRole.id,
      vendorId: null,
      emailVerified: false,
      emailMarketingConsent: false,
      emailSuppressed: false,
      avatarUrl: null,
    });

    const tokens = await generateTokens(user, meta);

    return {
      user: { id: user.id, email: user.email, name: user.name, role: 'CUSTOMER', vendorId: user.vendorId, permissions: [] },
      ...tokens,
    };
  }

  async login(
    dto: LoginRequest,
    meta: SessionDeviceMeta = {},
  ): Promise<{ user: { id: string; email: string; name: string; role: string; vendorId: string | null; permissions: string[] }; accessToken: string; refreshToken: string }> {
    const user = await repo.findByEmail(dto.email);
    if (!user) {
      throw new ValidationError({ email: ['Invalid credentials'] });
    }

    if (user.status === 'BLOCKED') {
      throw new ForbiddenError('Account is blocked');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new ValidationError({ email: ['Invalid credentials'] });
    }

    const tokens = await generateTokens(user, meta);

    const permissions = await resolvePermissionsForUser({ roleId: user.roleId, role: { name: user.role?.name ?? 'CUSTOMER' } });
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role?.name ?? 'CUSTOMER',
        vendorId: user.vendorId,
        permissions,
      },
      ...tokens,
    };
  }

  async refreshToken(rawToken: string, meta: SessionDeviceMeta = {}) {
    const tokenHash = hashToken(rawToken);
    const token = await repo.findRefreshToken(tokenHash);

    if (!token) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    if (token.expiresAt < new Date()) {
      throw new AppError('Refresh token expired', 401, 'REFRESH_TOKEN_EXPIRED');
    }

    await repo.deleteRefreshToken(tokenHash);

    const user = await repo.findById(token.userId);
    if (!user || user.status === 'BLOCKED') {
      throw new AppError('User not found or blocked', 401, 'UNAUTHORIZED');
    }

    clearPermissionCache();
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

    const token = jwt.sign({ sub: user.id, purpose: 'password-reset' }, env.JWT_SECRET, { expiresIn: '15m' });
    logger.info('Password reset token generated', { email: user.email });

    return token;
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
