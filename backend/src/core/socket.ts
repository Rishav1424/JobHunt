import { Server, Socket } from 'socket.io';
import { logger } from './logger';

let io: Server | null = null;

export function setupSocket(server: Server): void {
  io = server;

  server.on('connection', (socket: Socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    socket.on('subscribe:job', (jobId: string) => {
      socket.join(`job:${jobId}`);
      logger.debug(`Socket ${socket.id} subscribed to job:${jobId}`);
    });

    socket.on('unsubscribe:job', (jobId: string) => {
      socket.leave(`job:${jobId}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });
}

// ─── Event emitters (called from services) ───────────────────────────────────

export function emitJobScored(jobId: string, fitScore: number, fitAnalysis: unknown): void {
  io?.emit('job:scored', { jobId, fitScore, fitAnalysis });
}

export function emitNewJobs(count: number): void {
  io?.emit('jobs:new', { count });
}

export function emitApplyProgress(jobId: string, event: ApplyProgressEvent): void {
  io?.to(`job:${jobId}`).emit('apply:progress', event);
}

export function emitApplyPause(jobId: string, question: string, fieldName: string): void {
  io?.to(`job:${jobId}`).emit('apply:pause', { question, fieldName });
}

export function emitApplyComplete(jobId: string, success: boolean, screenshotPath?: string): void {
  io?.to(`job:${jobId}`).emit('apply:complete', { success, screenshotPath });
}

export interface ApplyProgressEvent {
  step: string;
  fieldName?: string;
  value?: string;
  status: 'filling' | 'filled' | 'error' | 'waiting';
  timestamp: number;
}
