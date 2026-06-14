/**
 * BullMQ Worker Process
 * Run separately from the API server: npm run dev:worker
 */
import { createScrapingWorker, createScoringWorker, recoverStuckJobs, setupGracefulShutdown } from '../jobs/queues';
import { connectDB } from '../core/prisma';
import { logger } from '../core/logger';

async function startWorker(): Promise<void> {
  logger.info('🔧 Starting BullMQ workers...');

  await connectDB();

  // ── Startup: Recover any stuck scoring jobs from previous crash ───────
  await recoverStuckJobs();

  const scrapingWorker = createScrapingWorker();
  const scoringWorker = createScoringWorker();

  scrapingWorker.on('completed', (job) => {
    const result = job.returnvalue as { total?: number; newJobs?: number } | undefined;
    logger.info(`✅ Scraping job ${job.id} completed: ${result?.newJobs ?? 0} new jobs from ${result?.total ?? 0} fetched`);
  });

  scrapingWorker.on('failed', (job, err) => {
    logger.error(`❌ Scraping job ${job?.id} failed`, { error: err.message });
  });

  scoringWorker.on('completed', (job) => {
    logger.info(`✅ Scoring job ${job.id} completed (score: ${job.returnvalue?.score})`);
  });

  scoringWorker.on('failed', (job, err) => {
    logger.error(`❌ Scoring job ${job?.id} failed after all retries`, { error: err.message });
  });

  // ── Graceful shutdown (lets current job finish) ───────────────────────
  setupGracefulShutdown(scrapingWorker, scoringWorker);

  logger.info('✅ Workers running: scraping (concurrency=1) + scoring (concurrency=1)');
  logger.info('🧠 Personalized scoring active: Rishav Sharma profile loaded');
  logger.info('🔄 Feedback learning loop active: approvals/skips will calibrate future scores');
  logger.info('⚡ Circuit breaker active: scrapers auto-disable on 3 consecutive failures');
}

startWorker().catch((err) => {
  logger.error('Worker startup failed', { error: err });
  process.exit(1);
});
