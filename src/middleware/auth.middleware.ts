import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@config/env';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { BEARER_PREFIX } from '@core/constants/http';
import { USER_STATUS } from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from '@core/constants/errors';
import { AppError } from '@core/errors/AppError';
import { sendApiError } from '@core/http/sendApiError';
import { roleNameOf } from '@utils/userRole';
import type { JwtPayload } from '@modules/auth/auth.types';
import { setImpersonatedBy } from '@core/context/requestContext';
import { redisClient, withRedis } from '@config/redis';

const BLOCKED_USER_CACHE_TTL_MS = 60_000;
const BLOCKED_USER_INVALIDATE_CHANNEL = 'auth:blocked-user-cache:invalidate';
const blockedUserCache = new Map<string, { blocked: boolean; expiresAt: number }>();

const blockedCacheSubscriber = redisClient.duplicate();
blockedCacheSubscriber.on('error', () => {});
blockedCacheSubscriber.on('message', (channel: string, message: string) => {
  if (channel === BLOCKED_USER_INVALIDATE_CHANNEL) {
    if (message) blockedUserCache.delete(message);
    else blockedUserCache.clear();
  }
});
void (async () => {
  try {
    if (blockedCacheSubscriber.status === 'wait' || blockedCacheSubscriber.status === 'end') {
      await blockedCacheSubscriber.connect();
    }
    await blockedCacheSubscriber.subscribe(BLOCKED_USER_INVALIDATE_CHANNEL);
  } catch {
    // Redis unavailable — falls back to local per-process invalidation.
  }
})();

process.once('beforeExit', () => {
  blockedCacheSubscriber.disconnect();
});

export function invalidateBlockedUserCache(userId?: string) {
  if (userId) blockedUserCache.delete(userId);
  else blockedUserCache.clear();
  void withRedis(() => redisClient.publish(BLOCKED_USER_INVALIDATE_CHANNEL, userId ?? ''));
}

function unauthorized(res: Response, code: ErrorCode, message: string) {
  sendApiError(res, new AppError(message, 401, code));
}

async function isUserBlocked(userId: string): Promise<boolean> {
  const cached = blockedUserCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.blocked;

  const user = await User.findByPk(userId, { attributes: ['status'] });
  const blocked = !user || user.status === USER_STATUS.BLOCKED;
  blockedUserCache.set(userId, {
    blocked,
    expiresAt: Date.now() + BLOCKED_USER_CACHE_TTL_MS,
  });
  return blocked;
}

export async function loadUserFromBearer(authHeader: string) {
  const token = authHeader.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    return { error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES.INVALID_TOKEN } as const };
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;

    if (await isUserBlocked(decoded.sub)) {
      return {
        error: {
          code: ERROR_CODES.UNAUTHORIZED,
          message: ERROR_MESSAGES.USER_NOT_FOUND_OR_BLOCKED,
        } as const,
      };
    }

    let roleName = decoded.roleName;
    if (!roleName) {
      const user = await User.findByPk(decoded.sub, {
        include: [{ model: Role, as: 'role' }],
        attributes: ['id', 'email', 'roleId', 'vendorId', 'status'],
      });
      if (!user) {
        return {
          error: {
            code: ERROR_CODES.UNAUTHORIZED,
            message: ERROR_MESSAGES.USER_NOT_FOUND_OR_BLOCKED,
          } as const,
        };
      }
      roleName = roleNameOf(user);
    }

    return {
      user: {
        id: decoded.sub,
        email: decoded.email,
        roleId: decoded.roleId,
        vendorId: decoded.vendorId,
        role: { name: roleName },
        impersonatedBy: decoded.impersonatedBy ?? null,
      },
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return {
        error: { code: ERROR_CODES.TOKEN_EXPIRED, message: ERROR_MESSAGES.TOKEN_EXPIRED } as const,
      };
    }
    return { error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES.INVALID_TOKEN } as const };
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith(BEARER_PREFIX)) {
    unauthorized(res, ERROR_CODES.UNAUTHORIZED, ERROR_MESSAGES.AUTH_REQUIRED);
    return;
  }

  const result = await loadUserFromBearer(authHeader);
  if ('error' in result && result.error) {
    unauthorized(res, result.error.code, result.error.message);
    return;
  }

  req.user = result.user!;
  setImpersonatedBy(req.user.impersonatedBy ?? null);
  next();
};

/**
 * Attaches req.user when a valid Bearer token is present.
 * Guests (no Authorization) continue. A present but expired/invalid Bearer returns 401
 * so clients can refresh — never silently treat an expired session as a guest cart.
 */
export const optionalAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith(BEARER_PREFIX)) {
    next();
    return;
  }

  const result = await loadUserFromBearer(authHeader);
  if ('error' in result && result.error) {
    unauthorized(res, result.error.code, result.error.message);
    return;
  }

  req.user = result.user!;
  setImpersonatedBy(req.user.impersonatedBy ?? null);
  next();
};
