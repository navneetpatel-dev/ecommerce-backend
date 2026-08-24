import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { authService, type SessionDeviceMeta } from './auth.service';
import { User } from '@database/models/user.model';
import { Role } from '@database/models/role.model';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { COOKIES, REFRESH_TOKEN_TTL_MS } from '@core/constants/http';
import { AUTH_COOKIE_PATH } from '@core/constants/apiPaths';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import { roleNameOf } from '@utils/userRole';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: AUTH_COOKIE_PATH,
  maxAge: REFRESH_TOKEN_TTL_MS,
};

function deviceMeta(req: Request): SessionDeviceMeta {
  return {
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : null,
    ipAddress: req.ip || (req.socket?.remoteAddress ?? null),
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body as any, deviceMeta(req));
  res.cookie(COOKIES.REFRESH_TOKEN, result.refreshToken, COOKIE_OPTIONS);
  res.status(201).json(ok({ user: result.user, accessToken: result.accessToken }));
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body as any, deviceMeta(req));
  res.cookie(COOKIES.REFRESH_TOKEN, result.refreshToken, COOKIE_OPTIONS);
  res.status(200).json(ok({ user: result.user, accessToken: result.accessToken }));
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIES.REFRESH_TOKEN] || req.body?.refreshToken;
  if (!token) {
    res.status(401).json({
      success: false,
      error: { code: ERROR_CODES.REFRESH_REQUIRED, message: ERROR_MESSAGES.REFRESH_REQUIRED },
    });
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
    res.status(400).json({
      success: false,
      error: { code: ERROR_CODES.SESSION_REQUIRED, message: ERROR_MESSAGES.SESSION_REQUIRED },
    });
    return;
  }
  await authService.revokeOtherSessions(req.user!.id, current);
  res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findByPk(req.user!.id, { include: [{ model: Role, as: 'role' }] });
  if (!user) { res.status(404).json({ success: false, error: { message: 'User not found' } }); return; }
  const roleName = roleNameOf(user);
  const permissions = await resolvePermissionsForUser({ roleId: user.roleId, role: { name: roleName } });
  res.json(ok({
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: roleName,
    vendorId: user.vendorId,
    emailVerified: user.emailVerified,
    emailMarketingConsent: user.emailMarketingConsent,
    avatarUrl: user.avatarUrl,
    permissions,
  }));
});
