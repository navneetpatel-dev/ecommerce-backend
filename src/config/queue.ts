import { Queue, QueueEvents, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { env } from './env';
import { logger } from '@core/logger';
import { redisClient } from './redis';

const redisUrl = new URL(env.REDIS_URL);

/** BullMQ requires maxRetriesPerRequest: null on its ioredis connection. */
const redisConnection: ConnectionOptions = {
  host: redisUrl.hostname || '127.0.0.1',
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/**
 * Queue names follow the notification architecture:
 * - email-transactional / email-marketing for email delivery
 * - sms / payout / notification for adjacent background work
 */
export const QUEUE_NAMES = [
  'email-transactional',
  'email-marketing',
  'sms',
  'payout',
  'notification',
  'report-export',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

let queuesReady = false;

const queueInstances = {} as Partial<Record<QueueName, Queue>>;
const queueEventInstances = {} as Partial<Record<QueueName, QueueEvents>>;

function ensureQueue(name: QueueName): Queue {
  const existing = queueInstances[name];
  if (existing) return existing;
  const queue = new Queue(name, { connection: redisConnection });
  queueInstances[name] = queue;
  return queue;
}

function ensureQueueEvents(name: QueueName): QueueEvents {
  const existing = queueEventInstances[name];
  if (existing) return existing;
  const events = new QueueEvents(name, { connection: redisConnection });
  queueEventInstances[name] = events;
  return events;
}

export const DEFAULT_TRANSACTIONAL_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export const DEFAULT_MARKETING_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Lazy accessors — queues are only created after Redis is confirmed reachable. */
export const queues = {
  get emailTransactional() {
    return ensureQueue('email-transactional');
  },
  get emailMarketing() {
    return ensureQueue('email-marketing');
  },
  /** @deprecated Prefer emailTransactional — kept for callers that used the old name. */
  get email() {
    return ensureQueue('email-transactional');
  },
  get sms() {
    return ensureQueue('sms');
  },
  get payout() {
    return ensureQueue('payout');
  },
  get notification() {
    return ensureQueue('notification');
  },
  get reportExport() {
    return ensureQueue('report-export');
  },
};

export const queueEvents = {
  get emailTransactional() {
    return ensureQueueEvents('email-transactional');
  },
  get emailMarketing() {
    return ensureQueueEvents('email-marketing');
  },
  get email() {
    return ensureQueueEvents('email-transactional');
  },
  get sms() {
    return ensureQueueEvents('sms');
  },
  get payout() {
    return ensureQueueEvents('payout');
  },
  get notification() {
    return ensureQueueEvents('notification');
  },
  get reportExport() {
    return ensureQueueEvents('report-export');
  },
};

export function getQueueConnection(): ConnectionOptions {
  return redisConnection;
}

async function redisIsReachable(): Promise<boolean> {
  try {
    const status = redisClient.status;
    if (status === 'wait' || status === 'end') {
      await redisClient.connect();
    }
    const pong = await Promise.race([
      redisClient.ping(),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Redis ping timeout')), 1500),
      ),
    ]);
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function connectQueues(): Promise<void> {
  const reachable = await redisIsReachable();
  if (!reachable) {
    queuesReady = false;
    throw new Error('Redis unavailable — skipping BullMQ queues');
  }

  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Queue connection timeout')), 5000),
    );

    await Promise.race([
      Promise.all(QUEUE_NAMES.map((name) => ensureQueue(name).waitUntilReady())),
      timeout,
    ]);

    queuesReady = true;
    logger.info('BullMQ queues connected', { queues: [...QUEUE_NAMES] });
  } catch (error) {
    queuesReady = false;
    await closeQueues().catch(() => undefined);
    logger.error('Failed to connect BullMQ queues', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

export function areQueuesReady(): boolean {
  return queuesReady;
}

export async function checkQueuesHealth(): Promise<{
  status: string;
  message: string;
  queues: Record<string, string>;
}> {
  if (!queuesReady) {
    return {
      status: 'down',
      message: 'Queues not connected (Redis optional in development)',
      queues: {},
    };
  }

  try {
    const queueStatuses: Record<string, string> = {};

    await Promise.race([
      (async () => {
        for (const name of QUEUE_NAMES) {
          try {
            await ensureQueue(name).getJobCounts();
            queueStatuses[name] = 'up';
          } catch {
            queueStatuses[name] = 'down';
          }
        }
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Queue health check timeout')), 2000),
      ),
    ]);

    const allUp = Object.values(queueStatuses).every((status) => status === 'up');

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

export async function closeQueues(): Promise<void> {
  const closers: Promise<unknown>[] = [];

  for (const name of QUEUE_NAMES) {
    const queue = queueInstances[name];
    const events = queueEventInstances[name];
    if (queue) closers.push(queue.close());
    if (events) closers.push(events.close());
    delete queueInstances[name];
    delete queueEventInstances[name];
  }

  if (closers.length) {
    await Promise.allSettled(closers);
    logger.info('BullMQ queues closed');
  }

  queuesReady = false;
}
