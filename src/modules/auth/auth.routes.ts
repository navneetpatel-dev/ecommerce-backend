import { Router } from 'express';
import { validate } from '@middleware/validate.middleware';
import { authenticate } from '@middleware/auth.middleware';
import { authRateLimiter } from '@middleware/rateLimiter.middleware';
import { RegisterSchema, LoginSchema, ForgotPasswordSchema, ResetPasswordSchema, ChangePasswordSchema } from './auth.dto';
import * as controller from './auth.controller';

const router = Router();

router.post('/register', validate(RegisterSchema), authRateLimiter, controller.register);
router.post('/login', validate(LoginSchema), authRateLimiter, controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', authenticate, controller.logout);
router.post('/forgot-password', validate(ForgotPasswordSchema), authRateLimiter, controller.forgotPassword);
router.post('/reset-password', validate(ResetPasswordSchema), controller.resetPassword);
router.post('/change-password', authenticate, validate(ChangePasswordSchema), controller.changePassword);

router.get('/sessions', authenticate, controller.listSessions);
router.delete('/sessions/:family', authenticate, controller.revokeSession);
router.delete('/sessions', authenticate, controller.revokeOtherSessions);

export { router as authRoutes };
