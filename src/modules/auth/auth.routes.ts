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

router.post('/register', validate(RegisterSchema), authRateLimiter, controller.register);
router.post('/login', validate(LoginSchema), authRateLimiter, controller.login);
router.post('/otp/request', validate(RequestOtpSchema), otpRequestRateLimiter, controller.requestOtp);
router.post('/otp/verify', validate(VerifyOtpSchema), authRateLimiter, controller.verifyOtp);
router.post('/refresh', controller.refresh);
router.post('/logout', authenticate, controller.logout);
router.post('/forgot-password', validate(ForgotPasswordSchema), authRateLimiter, controller.forgotPassword);
router.post('/reset-password', validate(ResetPasswordSchema), controller.resetPassword);
router.post('/verify-email', validate(VerifyEmailSchema), authRateLimiter, controller.verifyEmail);
router.post('/verify-email/resend', validate(ResendVerificationByEmailSchema), otpRequestRateLimiter, controller.resendVerificationByEmail);
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

export { router as authRoutes };
