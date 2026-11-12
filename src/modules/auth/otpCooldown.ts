import crypto from 'crypto';
import { redisClient, withRedis } from '@config/redis';

/** Seconds between sign-in codes for one email (C-07). */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * One sign-in code per email per minute, on top of the per-IP limiter. The reply to the
 * shopper is the same either way (B-02); a request inside the minute simply sends nothing.
 * If Redis is unavailable the code is sent, as before.
 */
export const otpCooldown = {
  async claim(email: string): Promise<boolean> {
    const digest = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
    const key = `otp:cooldown:${digest}`;
    const claimed = await withRedis(() => redisClient.set(key, '1', 'EX', OTP_RESEND_COOLDOWN_SECONDS, 'NX'));
    if (claimed === 'OK') return true;
    return (await withRedis(() => redisClient.exists(key))) !== 1;
  },
};
