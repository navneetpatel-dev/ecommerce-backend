import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { authService, type SessionDeviceMeta } from './auth.service';
import {
  buildGoogleAuthUrl,
  completeGoogleOAuth,
  createOAuthState,
  isGoogleOAuthConfigured,
} from './googleOAuth.service';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { COOKIES, REFRESH_TOKEN_TTL_MS } from '@core/constants/http';
import { AUTH_COOKIE_PATH } from '@core/constants/apiPaths';
import { AppError } from '@core/errors';
import { sendApiError } from '@core/http/sendApiError';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { env } from '@config/env';
import { roleNameOf } from '@utils/userRole';

const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_REDIRECT_COOKIE = 'oauth_redirect';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: AUTH_COOKIE_PATH,
  maxAge: REFRESH_TOKEN_TTL_MS,
};

const OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 10 * 60 * 1000,
};

function normalizeIpAddress(value: string | undefined): string | null {
  if (!value) return null;
  if (value === '::1') return '127.0.0.1';
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

function deviceMeta(req: Request): SessionDeviceMeta {
  return {
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : null,
    ipAddress: normalizeIpAddress(req.ip || req.socket?.remoteAddress),
  };
}

function clientAuthCallbackUrl(params: Record<string, string>): string {
  const base = env.CLIENT_URL.replace(/\/$/, '');
  const query = new URLSearchParams(params).toString();
  return `${base}/auth/callback${query ? `?${query}` : ''}`;
}

export const googleStart = asyncHandler(async (req: Request, res: Response) => {
  if (!isGoogleOAuthConfigured()) {
    res.redirect(
      clientAuthCallbackUrl({
        error: ERROR_CODES.OAUTH_NOT_CONFIGURED,
        message: ERROR_MESSAGES.OAUTH_GOOGLE_NOT_CONFIGURED,
      }),
    );
    return;
  }

  const state = createOAuthState();
  res.cookie(OAUTH_STATE_COOKIE, state, OAUTH_STATE_COOKIE_OPTIONS);

  const redirect = typeof req.query.redirect === 'string' ? req.query.redirect : '';
  if (redirect && redirect.startsWith('/')) {
    res.cookie(OAUTH_REDIRECT_COOKIE, redirect, OAUTH_STATE_COOKIE_OPTIONS);
  }

  res.redirect(buildGoogleAuthUrl(state));
});

export const googleCallback = asyncHandler(async (req: Request, res: Response) => {
  const clearOAuthCookies = () => {
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
    res.clearCookie(OAUTH_REDIRECT_COOKIE, { path: '/' });
  };

  const fail = (code: string, message: string) => {
    clearOAuthCookies();
    res.redirect(clientAuthCallbackUrl({ error: code, message }));
  };

  if (!isGoogleOAuthConfigured()) {
    fail(ERROR_CODES.OAUTH_NOT_CONFIGURED, ERROR_MESSAGES.OAUTH_GOOGLE_NOT_CONFIGURED);
    return;
  }

  const oauthError = typeof req.query.error === 'string' ? req.query.error : null;
  if (oauthError) {
    fail(ERROR_CODES.OAUTH_NOT_CONFIGURED, ERROR_MESSAGES.OAUTH_GOOGLE_FAILED);
    return;
  }

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const savedState = req.cookies?.[OAUTH_STATE_COOKIE];
  if (!state || !savedState || state !== savedState) {
    fail(ERROR_CODES.VALIDATION_ERROR, ERROR_MESSAGES.OAUTH_STATE_INVALID);
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    fail(ERROR_CODES.VALIDATION_ERROR, ERROR_MESSAGES.OAUTH_GOOGLE_FAILED);
    return;
  }

  try {
    const result = await completeGoogleOAuth(code, deviceMeta(req));
    res.cookie(COOKIES.REFRESH_TOKEN, result.refreshToken, COOKIE_OPTIONS);

    const redirect =
      typeof req.cookies?.[OAUTH_REDIRECT_COOKIE] === 'string'
        ? req.cookies[OAUTH_REDIRECT_COOKIE]
        : '';
    clearOAuthCookies();

    const params: Record<string, string> = {
      accessToken: result.accessToken,
    };
    if (redirect && redirect.startsWith('/')) {
      params.redirect = redirect;
    }

    res.redirect(clientAuthCallbackUrl(params));
  } catch (err: any) {
    const details = err?.details;
    let message: string = ERROR_MESSAGES.OAUTH_GOOGLE_FAILED;
    if (typeof err?.message === 'string' && err.message !== 'Validation failed') {
      message = err.message;
    } else if (details && typeof details === 'object') {
      const oauth = (details as Record<string, string[]>).oauth;
      const email = (details as Record<string, string[]>).email;
      if (Array.isArray(oauth) && oauth[0]) message = oauth[0];
      else if (Array.isArray(email) && email[0]) message = email[0];
    }
    fail(err?.code || ERROR_CODES.VALIDATION_ERROR, message);
  }
});

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body as any);
  res.status(201).json(ok(result));
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body as any, deviceMeta(req));
  res.cookie(COOKIES.REFRESH_TOKEN, result.refreshToken, COOKIE_OPTIONS);
  res.status(200).json(ok({ user: result.user, accessToken: result.accessToken }));
});

export const requestOtp = asyncHandler(async (req: Request, res: Response) => {
  await authService.requestLoginOtp(req.body.email);
  res.status(200).json(ok({ message: 'A sign-in code has been sent to your email' }));
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.loginWithOtp(req.body.email, req.body.code, deviceMeta(req));
  res.cookie(COOKIES.REFRESH_TOKEN, result.refreshToken, COOKIE_OPTIONS);
  res.status(200).json(ok({ user: result.user, accessToken: result.accessToken }));
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIES.REFRESH_TOKEN] || req.body?.refreshToken;
  if (!token) {
    sendApiError(
      res,
      new AppError(ERROR_MESSAGES.REFRESH_REQUIRED, 401, ERROR_CODES.REFRESH_REQUIRED),
    );
    return;
  }
  const result = await authService.refreshToken(token, deviceMeta(req));
  res.cookie(COOKIES.REFRESH_TOKEN, result.refreshToken, COOKIE_OPTIONS);
  res.status(200).json(ok({ accessToken: result.accessToken }));
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIES.REFRESH_TOKEN];
  if (token) {
    await authService.logout(token);
  }
  res.clearCookie(COOKIES.REFRESH_TOKEN, { path: AUTH_COOKIE_PATH });
  res.status(200).json(ok({ message: 'Logged out' }));
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body.email);
  res.status(200).json(ok({ message: 'If that email exists, a reset link has been sent' }));
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  res.status(200).json(ok({ message: 'Password has been reset' }));
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyEmail(req.body.token);
  res.status(200).json(ok(result));
});

export const resendVerificationByEmail = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.resendEmailVerificationByEmail(req.body.email);
  res.status(200).json(ok(result));
});

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.resendEmailVerification(req.user!.id);
  res.status(200).json(ok(result));
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
  res.status(200).json(ok({ message: 'Password changed' }));
});

export const listSessions = asyncHandler(async (req: Request, res: Response) => {
  const current = req.cookies?.[COOKIES.REFRESH_TOKEN] ?? null;
  const sessions = await authService.listSessions(req.user!.id, current);
  res.json(ok(sessions));
});

export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  await authService.revokeSession(req.user!.id, req.params.family!);
  res.status(204).send();
});

export const revokeOtherSessions = asyncHandler(async (req: Request, res: Response) => {
  const current = req.cookies?.[COOKIES.REFRESH_TOKEN];
  if (!current) {
    sendApiError(
      res,
      new AppError(ERROR_MESSAGES.SESSION_REQUIRED, 400, ERROR_CODES.SESSION_REQUIRED),
    );
    return;
  }
  await authService.revokeOtherSessions(req.user!.id, current);
  res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findByPk(req.user!.id, { include: [{ model: Role, as: 'role' }] });
  if (!user) {
    sendApiError(res, new AppError(ERROR_MESSAGES.NOT_FOUND, 404, ERROR_CODES.NOT_FOUND));
    return;
  }
  const roleName = roleNameOf(user);
  const permissions = await resolvePermissionsForUser({ roleId: user.roleId, role: { name: roleName } });
  res.json(ok({
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: roleName,
    vendorId: user.vendorId,
    deliveryAgentId: user.deliveryAgentId,
    emailVerified: user.emailVerified,
    emailMarketingConsent: user.emailMarketingConsent,
    avatarUrl: user.avatarUrl,
    permissions,
  }));
});
