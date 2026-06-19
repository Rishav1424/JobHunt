import { Queue, Worker, Job } from 'bullmq';
import { config } from '../core/config';
import { runAllScrapers } from '../services/scrapers/index';
import { scoreJob, ensureProfileEmbedding } from '../services/ai-engine/scorer';
import { prisma } from '../core/prisma';
import { logger } from '../core/logger';
import { emitJobScored, emitNewJobs } from '../core/socket';

// BullMQ connection config — use URL string to avoid ioredis version conflicts
const bullConnection = { url: config.REDIS_URL };

// ─── Queue Names ──────────────────────────────────────────────────────────────
export const QUEUE_NAMES = {
  SCRAPING: 'job-scraping',
  SCORING: 'job-scoring',
} as const;

// ─── Queues ───────────────────────────────────────────────────────────────────
export const scrapingQueue = new Queue(QUEUE_NAMES.SCRAPING, {
  connection: bullConnection,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 20,
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
  },
});

export const scoringQueue = new Queue(QUEUE_NAMES.SCORING, {
  connection: bullConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 4,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

// ─── Stuck Job Recovery ───────────────────────────────────────────────────────
/**
 * On startup, find any jobs that got stuck in SCORING status from a previous crash
 * and re-queue them for scoring.
 */
export async function recoverStuckJobs(): Promise<void> {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const stuck = await prisma.job.findMany({
      where: {
        status: 'SCORING',
        updatedAt: { lt: thirtyMinutesAgo },
      },
      select: { id: true, title: true, company: true },
    });

    if (stuck.length === 0) {
      logger.info('✅ No stuck scoring jobs found');
      return;
    }

    logger.warn(`Found ${stuck.length} stuck scoring jobs — re-queuing...`);

    const scoringJobs = stuck.map((j) => ({
      name: 'score-job',
      data: { jobId: j.id },
      opts: { priority: 2 },
    }));

    await scoringQueue.addBulk(scoringJobs);
    logger.info(`Re-queued ${stuck.length} stuck jobs`);
  } catch (err) {
    logger.error('Failed to recover stuck jobs', { error: err });
  }
}

// ─── Workers ──────────────────────────────────────────────────────────────────

export function createScrapingWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.SCRAPING,
    async (_job: Job) => {
      logger.info('🔍 Starting job scraping run...');

      // Ensure profile embedding is ready before scoring
      await ensureProfileEmbedding();

      const { total, newJobs, scraperResults } = await runAllScrapers();
      logger.info(`Scraping complete: ${total} fetched, ${newJobs} new jobs`, { scraperResults });

      if (newJobs > 0) {
        emitNewJobs(newJobs);

        // Enqueue scoring for all NEW jobs
        const newJobRecords = await prisma.job.findMany({
          where: { status: 'NEW' },
          select: { id: true },
        });

        if (newJobRecords.length > 0) {
          const ids = newJobRecords.map((j) => j.id);
          
          // Mark as SCORING atomically for these specific jobs only
          await prisma.job.updateMany({
            where: { id: { in: ids } },
            data: { status: 'SCORING' },
          });

          const scoringJobs = newJobRecords.map((j) => ({
            name: 'score-job',
            data: { jobId: j.id },
            opts: { priority: 1 },
          }));

          await scoringQueue.addBulk(scoringJobs);
          logger.info(`Enqueued ${scoringJobs.length} scoring jobs`);
        }
      }

      return { total, newJobs, scraperResults };
    },
    { connection: bullConnection, concurrency: 1 }
  );
}

export function createScoringWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.SCORING,
    async (job: Job<{ jobId: string }>) => {
      const { jobId } = job.data;
      logger.info(`Scoring job ${jobId}...`);

      const analysis = await scoreJob(jobId);

      if (analysis) {
        emitJobScored(jobId, analysis.score, analysis);
        logger.info(`✅ Scoring job ${job.id} completed (score: ${analysis.score})`);
      } else {
        logger.warn(`Scoring returned null for job ${jobId} — may have been pre-screened`);
      }

      return { jobId, score: analysis?.score };
    },
    {
      connection: bullConnection,
      concurrency: 1,  // Rate limit: 15 RPM Gemini, serialize calls
    }
  );
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
export function setupGracefulShutdown(scrapingWorker: Worker, scoringWorker: Worker): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — gracefully shutting down workers...`);
    try {
      await Promise.all([
        scrapingWorker.close(),
        scoringWorker.close(),
      ]);
      logger.info('Workers closed cleanly');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: err });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ─── Manual Triggers (called from API) ───────────────────────────────────────
export async function triggerManualScrape(): Promise<void> {
  await scrapingQueue.add('manual-scrape', {}, {
    priority: 1,
    jobId: `manual-${Date.now()}`,
  });
  logger.info('Manual scrape triggered');
}

export async function triggerJobScore(jobId: string): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { status: 'SCORING' } });
  await scoringQueue.add('score-job', { jobId }, { priority: 1 });
  logger.info(`Manual score triggered for job ${jobId}`);
}
