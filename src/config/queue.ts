import { Queue, QueueEvents } from 'bullmq';
import { env } from './env';
import { logger } from '@core/logger';

// parse redis url for connection
const redisUrl = new URL(env.REDIS_URL);
const redisConnection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port) || 6379,
  password: redisUrl.password || undefined,
};

// define all queues
export const emailQueue = new Queue('email', { connection: redisConnection });
export const smsQueue = new Queue('sms', { connection: redisConnection });
export const payoutQueue = new Queue('payout', { connection: redisConnection });
export const notificationQueue = new Queue('notification', { connection: redisConnection });

// queue events for monitoring
const emailQueueEvents = new QueueEvents('email', { connection: redisConnection });
const smsQueueEvents = new QueueEvents('sms', { connection: redisConnection });
const payoutQueueEvents = new QueueEvents('payout', { connection: redisConnection });
const notificationQueueEvents = new QueueEvents('notification', { connection: redisConnection });

// export queues for easy access
export const queues = {
  email: emailQueue,
  sms: smsQueue,
  payout: payoutQueue,
  notification: notificationQueue,
};

// export queue events
export const queueEvents = {
  email: emailQueueEvents,
  sms: smsQueueEvents,
  payout: payoutQueueEvents,
  notification: notificationQueueEvents,
};

// connect to queues
export async function connectQueues(): Promise<void> {
  try {
    // wait for all queues to be ready with timeout
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Queue connection timeout')), 5000)
    );
    
    await Promise.race([
      Promise.all([
        emailQueue.waitUntilReady(),
        smsQueue.waitUntilReady(),
        payoutQueue.waitUntilReady(),
        notificationQueue.waitUntilReady(),
      ]),
      timeout
    ]);
    
    logger.info('BullMQ queues connected', {
      queues: Object.keys(queues),
    });
  } catch (error) {
    logger.error('Failed to connect BullMQ queues', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// check queue health status
export async function checkQueuesHealth(): Promise<{ status: string; message: string; queues: Record<string, string> }> {
  try {
    const queueStatuses: Record<string, string> = {};
    
    const timeout = new Promise<void>((_, reject) => 
      setTimeout(() => reject(new Error('Queue health check timeout')), 2000)
    );
    
    const checkPromise = (async () => {
      for (const [name, queue] of Object.entries(queues)) {
        try {
          // lightweight check using job counts with timeout
          await queue.getJobCounts();
          queueStatuses[name] = 'up';
        } catch {
          queueStatuses[name] = 'down';
        }
      }
    })();
    
    await Promise.race([checkPromise, timeout]);
    
    const allUp = Object.values(queueStatuses).every(status => status === 'up');
    
    return {
      status: allUp ? 'up' : 'degraded',
      message: allUp ? 'All queues operational' : 'Some queues are down',
      queues: queueStatuses,
    };
  } catch (error) {
    return {
      status: 'down',
      message: error instanceof Error ? error.message : 'Connection failed',
      queues: {},
    };
  }
}

// graceful shutdown
export async function closeQueues(): Promise<void> {
  await Promise.all([
    emailQueue.close(),
    smsQueue.close(),
    payoutQueue.close(),
    notificationQueue.close(),
    emailQueueEvents.close(),
    smsQueueEvents.close(),
    payoutQueueEvents.close(),
    notificationQueueEvents.close(),
  ]);
  logger.info('BullMQ queues closed');
}
