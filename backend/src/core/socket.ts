import { Server, Socket } from 'socket.io';
import { logger } from './logger';
import { AutofillAgentExecutor } from '../services/ai-engine/autofillAgent';
import { redisSubscriber } from './redis';

let io: Server | null = null;

export function setupSocket(server: Server): void {
  io = server;

  // Stream backend and worker logs via Redis pub/sub
  redisSubscriber.subscribe('system:logs:pubsub').catch((err) => {
    logger.error('Failed to subscribe to system:logs:pubsub Redis channel', { err });
  });

  redisSubscriber.on('message', (channel, message) => {
    if (channel === 'system:logs:pubsub') {
      try {
        const log = JSON.parse(message);
        io?.emit('system:log', log);
      } catch (err) {
        // ignore
      }
    }
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

    // ── Response Message Listeners ───────────────────────────────────────────
    const relayEvents = [
      'page:classify:response',
      'fields:extract:response',
      'field:inject:response',
      'fields:validate:response',
      'page:observe:response',
      'field:upload:response',
      'dom:click:response',
      'dom:navigate:response',
      'auth:check-credentials:response',
      'auth:fill-credentials:response',
      'otp:retrieve:response',
      'magic_link:retrieve:response'
    ];

    relayEvents.forEach((evt) => {
      socket.on(evt, (payload) => {
        logger.debug(`Received response event from frontend: ${evt}`);
        const executor = AutofillAgentExecutor.getRun(socket.id) || AutofillAgentExecutor.getRun(payload?.jobId || '');
        if (executor) {
          executor.handleResponse(evt, payload);
        }
      });
    });

    // ── Autofill WebSocket Listeners ─────────────────────────────────────────
    socket.on('autofill:start', async (data: { jobId: string; fields?: any[] }) => {
      logger.info(`Received autofill:start from socket ${socket.id} for jobId: ${data.jobId}`);
      
      const onStateChange = (updatedState: any) => {
        socket.emit('autofill:state-change', updatedState);
      };

      const sendCommand = (event: string, payload: any) => {
        socket.emit(event, payload);
      };

      // Check if there is an active in-memory run first
      let executor = AutofillAgentExecutor.getRun(data.jobId);
      if (executor) {
        logger.info(`Re-associating existing in-memory run with new socket ${socket.id} for jobId: ${data.jobId}`);
        executor.updateSocket(socket.id, onStateChange, sendCommand);
        socket.emit('autofill:state-change', executor.state);
        return;
      }

      // Check if there is a persisted run in Redis
      const persistedState = await AutofillAgentExecutor.getRunState(data.jobId);
      if (persistedState) {
        logger.info(`Restoring persisted autofill run from Redis for jobId: ${data.jobId}`);
        executor = new AutofillAgentExecutor(
          data.jobId,
          persistedState.fields,
          socket.id,
          onStateChange,
          sendCommand
        );
        executor.state = persistedState;
        AutofillAgentExecutor.registerRun(data.jobId, executor);
        AutofillAgentExecutor.registerRun(socket.id, executor);

        // Emit current state back to client
        socket.emit('autofill:state-change', executor.state);

        // Resume if in active state
        if (executor.state.status !== 'COMPLETED' && executor.state.status !== 'FAILED' && executor.state.status !== 'HITL_REQUIRED') {
          await executor.execute();
        }
        return;
      }

      // Fresh run
      executor = new AutofillAgentExecutor(
        data.jobId,
        data.fields || [],
        socket.id,
        onStateChange,
        sendCommand
      );
      
      AutofillAgentExecutor.registerRun(socket.id, executor);
      AutofillAgentExecutor.registerRun(data.jobId, executor);
      await executor.execute();
    });

    socket.on('autofill:hitl-resolve', async (data: { jobId?: string; answers: Record<string, string> }) => {
      logger.info(`Received autofill:hitl-resolve from socket ${socket.id} (jobId: ${data.jobId})`);
      
      let executor = AutofillAgentExecutor.getRun(socket.id);
      if (!executor && data.jobId) {
        executor = AutofillAgentExecutor.getRun(data.jobId);
      }

      const onStateChange = (updatedState: any) => {
        socket.emit('autofill:state-change', updatedState);
      };

      const sendCommand = (event: string, payload: any) => {
        socket.emit(event, payload);
      };

      // If still not found in memory, try to restore from Redis
      if (!executor && data.jobId) {
        const persistedState = await AutofillAgentExecutor.getRunState(data.jobId);
        if (persistedState) {
          logger.info(`Restoring persisted autofill run from Redis on HITL resolve for jobId: ${data.jobId}`);
          executor = new AutofillAgentExecutor(
            data.jobId,
            persistedState.fields,
            socket.id,
            onStateChange,
            sendCommand
          );
          executor.state = persistedState;
          AutofillAgentExecutor.registerRun(data.jobId, executor);
          AutofillAgentExecutor.registerRun(socket.id, executor);
        }
      }
      
      if (executor) {
        executor.updateSocket(socket.id, onStateChange, sendCommand);
        await executor.execute(data.answers);
      } else {
        logger.warn(`No active autofill run found to resolve for socket: ${socket.id}`);
        socket.emit('autofill:error', { message: 'Autofill session expired or not found.' });
      }
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
      AutofillAgentExecutor.removeSocketMapping(socket.id);
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
