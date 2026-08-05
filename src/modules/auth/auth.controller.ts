import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { authService } from './auth.service';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(req.body as any);
  res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS);
  res.status(201).json(ok({ user: result.user, accessToken: result.accessToken }));
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body as any);
  res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS);
  res.status(200).json(ok({ user: result.user, accessToken: result.accessToken }));
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!token) {
    res.status(401).json({ success: false, error: { code: 'REFRESH_REQUIRED', message: 'Refresh token required' } });
    return;
  }
  const result = await authService.refreshToken(token);
  res.cookie('refreshToken', result.refreshToken, COOKIE_OPTIONS);
  res.status(200).json(ok({ accessToken: result.accessToken }));
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    await authService.logout(token);
  }
  res.clearCookie('refreshToken', { path: '/api/auth' });
  res.status(200).json(ok({ message: 'Logged out' }));
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const token = await authService.forgotPassword(req.body.email);
  res.status(200).json(ok({ message: 'If that email exists, a reset link has been sent' }));
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  res.status(200).json(ok({ message: 'Password has been reset' }));
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
  res.status(200).json(ok({ message: 'Password changed' }));
});
