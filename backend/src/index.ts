import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';

import { config } from './core/config';
import { logger } from './core/logger';
import { connectDB } from './core/prisma';
import { setupSocket } from './core/socket';
import { startScheduler } from './jobs/scheduler';

import { jobsRouter } from './api/jobs';
import { applicationsRouter } from './api/applications';
import { settingsRouter } from './api/settings';

// ─── Storage directory ────────────────────────────────────────────────────────
if (!fs.existsSync(config.STORAGE_PATH)) {
  fs.mkdirSync(config.STORAGE_PATH, { recursive: true });
}

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: config.FRONTEND_URL,
    credentials: true,
  },
});
setupSocket(io);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.FRONTEND_URL, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve stored PDFs and screenshots
app.use('/storage', express.static(config.STORAGE_PATH));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/jobs', jobsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/settings', settingsRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  await connectDB();

  httpServer.listen(config.PORT, () => {
    logger.info(`🚀 JobHunt API running on http://localhost:${config.PORT}`);
    logger.info(`📊 Bull Board queue monitor: http://localhost:3001`);
    logger.info(`🌐 Frontend: ${config.FRONTEND_URL}`);
  });

  // Start the scraping scheduler (non-blocking)
  startScheduler().catch((err) =>
    logger.error('Scheduler startup error', { error: err })
  );
}

main().catch((err) => {
  logger.error('Server startup failed', { error: err });
  process.exit(1);
});

export { io };
