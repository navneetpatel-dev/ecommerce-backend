import { Queue } from 'bullmq';
import { CONFIG } from '../config';

let queue: Queue | null = null;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue('email-transactional', { connection: { url: CONFIG.redisUrl } });
  }
  return queue;
}

/**
 * Polls the real email-transactional BullMQ queue for the DELIVERY_OTP job addressed to
 * `userId`, extracting the plaintext code from job.data.templateData.code. This reads the
 * genuine production OTP path (issued via otpService + enqueued as a real notification job),
 * not a bypass — the job succeeds or fails at actually sending email (no real SMTP creds in
 * dev), but its data payload (including the code) is present on the job regardless.
 */
export async function pollDeliveryOtp(userId: string, timeoutMs = 8000): Promise<string | null> {
  const q = getQueue();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const jobs = await q.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed'], 0, 100);
    const match = jobs.find(
      (j) =>
        j.data?.userId === userId &&
        (j.data?.type === 'DELIVERY_OTP' || j.data?.templateName === 'DELIVERY_OTP'),
    );
    if (match) {
      const code = match.data?.templateData?.code ?? match.data?.code;
      if (code) return String(code);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

export async function closeOtpQueue() {
  if (queue) await queue.close();
}
