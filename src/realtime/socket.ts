import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '@config/env';
import { logger } from '@core/logger';
import { BEARER_PREFIX } from '@core/constants/http';
import { loadUserFromBearer } from '@middleware/auth.middleware';
import { ExportJob } from '@database/models/exportJob.model';

type SocketUser = {
  id: string;
  vendorId: string | null;
  role: { name: string };
} | null;

let io: SocketIOServer | null = null;

/**
 * Realtime transport for export jobs: a client emits `subscribe:export-job` for a job it
 * owns and receives that job's progress events (`emitExportJobEvent`).
 */
export function initSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    path: '/socket.io',
    cors: {
      origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://localhost:3000'],
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      socket.data.user = null as SocketUser;
      next();
      return;
    }
    const result = await loadUserFromBearer(`${BEARER_PREFIX}${token}`);
    socket.data.user = ('error' in result && result.error) ? null : (result.user as SocketUser);
    next();
  });

  io.on('connection', (socket) => {
    socket.on(
      'subscribe:export-job',
      async (
        payload: { jobId?: string },
        ack?: (res: { ok: boolean; message?: string }) => void,
      ) => {
        try {
          const jobId = String(payload?.jobId ?? '').trim();
          const user = socket.data.user as SocketUser;
          if (!jobId || !user) {
            ack?.({ ok: false, message: 'Not authorized' });
            return;
          }
          const job = await ExportJob.findByPk(jobId, { attributes: ['id', 'ownerId'] });
          if (!job || job.ownerId !== user.id) {
            ack?.({ ok: false, message: 'Export job not found' });
            return;
          }
          socket.join(`export-job:${jobId}`);
          ack?.({ ok: true });
        } catch (error) {
          logger.warn('socket subscribe:export-job failed', {
            error: error instanceof Error ? error.message : error,
          });
          ack?.({ ok: false, message: 'Could not subscribe' });
        }
      },
    );
  });

  logger.info('Socket.IO realtime server initialized');
  return io;
}

export function emitExportJobEvent(
  jobId: string,
  event: 'export:progress' | 'export:completed' | 'export:failed',
  payload: Record<string, unknown>,
): void {
  io?.to(`export-job:${jobId}`).emit(event, payload);
}
