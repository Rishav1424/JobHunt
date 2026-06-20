import { Server, Socket } from 'socket.io';
import { logger, setLogCallback } from './logger';
import { AutofillGraphExecutor } from '../services/ai-engine/autofillGraph';

let io: Server | null = null;

export function setupSocket(server: Server): void {
  io = server;

  // Stream backend logs in real-time to frontend
  setLogCallback((log) => {
    io?.emit('system:log', log);
  });

  server.on('connection', (socket: Socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    socket.on('subscribe:job', (jobId: string) => {
      socket.join(`job:${jobId}`);
      logger.debug(`Socket ${socket.id} subscribed to job:${jobId}`);
    });

    socket.on('unsubscribe:job', (jobId: string) => {
      socket.leave(`job:${jobId}`);
    });

    // ── Autofill WebSocket Listeners ─────────────────────────────────────────
    socket.on('autofill:start', async (data: { jobId: string; fields: any[] }) => {
      logger.info(`Received autofill:start from socket ${socket.id} for jobId: ${data.jobId}`);
      
      const executor = new AutofillGraphExecutor(
        data.jobId,
        data.fields,
        socket.id,
        (updatedState) => {
          socket.emit('autofill:state-change', updatedState);
        }
      );
      
      AutofillGraphExecutor.registerRun(socket.id, executor);
      await executor.execute();
    });

    socket.on('autofill:hitl-resolve', async (data: { answers: Record<string, string> }) => {
      logger.info(`Received autofill:hitl-resolve from socket ${socket.id}`);
      
      const executor = AutofillGraphExecutor.getRun(socket.id);
      if (executor) {
        await executor.execute(data.answers);
      } else {
        logger.warn(`No active autofill run found to resolve for socket: ${socket.id}`);
        socket.emit('autofill:error', { message: 'Autofill session expired or not found.' });
      }
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
      AutofillGraphExecutor.removeRun(socket.id);
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

export function emitScrapingStatus(status: 'idle' | 'running' | 'completed' | 'failed', data?: any): void {
  io?.emit('scraping:status', { status, ...data, timestamp: Date.now() });
}

export function emitScoringStatus(status: 'idle' | 'running' | 'completed' | 'failed', data?: any): void {
  io?.emit('scoring:status', { status, ...data, timestamp: Date.now() });
}

export interface ApplyProgressEvent {
  step: string;
  fieldName?: string;
  value?: string;
  status: 'filling' | 'filled' | 'error' | 'waiting';
  timestamp: number;
}
