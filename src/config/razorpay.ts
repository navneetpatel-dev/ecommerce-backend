import Razorpay from 'razorpay';
import { env } from '@config/env';

const keyId = env.RAZORPAY_KEY_ID;
const keySecret = env.RAZORPAY_KEY_SECRET;

export const razorpayConfigured = Boolean(keyId && keySecret);

export const razorpay = razorpayConfigured
  ? new Razorpay({
      key_id: keyId!,
      key_secret: keySecret!,
    })
  : (null as unknown as Razorpay);
