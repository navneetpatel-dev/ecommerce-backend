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

interface JwtPayload {
  sub: string;
  email: string;
  roleId: string;
  vendorId: string | null;
}

function unauthorized(res: Response, code: ErrorCode, message: string) {
  sendApiError(res, new AppError(message, 401, code));
}

async function loadUserFromBearer(authHeader: string) {
  const token = authHeader.slice(BEARER_PREFIX.length).trim();
  if (!token) {
    return { error: { code: ERROR_CODES.UNAUTHORIZED, message: ERROR_MESSAGES.INVALID_TOKEN } as const };
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const user = await User.findByPk(decoded.sub, { include: [{ model: Role, as: 'role' }] });
    if (!user || user.status === USER_STATUS.BLOCKED) {
      return {
        error: {
          code: ERROR_CODES.UNAUTHORIZED,
          message: ERROR_MESSAGES.USER_NOT_FOUND_OR_BLOCKED,
        } as const,
      };
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        roleId: user.roleId,
        vendorId: user.vendorId,
        role: { name: roleNameOf(user) },
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
  next();
};
