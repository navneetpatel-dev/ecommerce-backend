import { Router } from 'express';
import { validate } from '@middleware/validate.middleware';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { authRateLimiter, otpRequestRateLimiter } from '@middleware/rateLimiter.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { RegisterSchema, LoginSchema, RequestOtpSchema, VerifyOtpSchema, ForgotPasswordSchema, ResetPasswordSchema, ChangePasswordSchema, VerifyEmailSchema, ResendVerificationByEmailSchema } from './auth.dto';
import * as controller from './auth.controller';

const router = Router();

router.get('/google', controller.googleStart);
router.get('/google/callback', controller.googleCallback);

router.post('/register', authRateLimiter, validate(RegisterSchema), controller.register);
router.post('/login', authRateLimiter, validate(LoginSchema), controller.login);
router.post('/otp/request', otpRequestRateLimiter, validate(RequestOtpSchema), controller.requestOtp);
router.post('/otp/verify', authRateLimiter, validate(VerifyOtpSchema), controller.verifyOtp);
router.post('/refresh', controller.refresh);
router.post('/logout', authenticate, controller.logout);
router.post('/forgot-password', authRateLimiter, validate(ForgotPasswordSchema), controller.forgotPassword);
router.post('/reset-password', authRateLimiter, validate(ResetPasswordSchema), controller.resetPassword);
router.post('/verify-email', authRateLimiter, validate(VerifyEmailSchema), controller.verifyEmail);
router.post(
  '/verify-email/resend',
  otpRequestRateLimiter,
  validate(ResendVerificationByEmailSchema),
  controller.resendVerificationByEmail,
);
router.post('/resend-verification', authenticate, authRateLimiter, controller.resendVerification);
router.post('/change-password', authenticate, validate(ChangePasswordSchema), controller.changePassword);
router.get('/me', authenticate, controller.me);

router.post(
  '/impersonate/:userId',
  authenticate,
  authorize(PERMISSIONS.USER_IMPERSONATE),
  controller.impersonate,
);

router.get('/sessions', authenticate, controller.listSessions);
router.delete('/sessions/:family', authenticate, controller.revokeSession);
router.delete('/sessions', authenticate, controller.revokeOtherSessions);

export default router;
