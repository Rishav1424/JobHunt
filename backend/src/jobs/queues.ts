import { Queue, Worker, Job } from 'bullmq';
import { config } from '../core/config';
import { runAllScrapers } from '../services/scrapers/index';
import { scoreJob, scoreJobsBatch, ensureProfileEmbedding } from '../services/ai-engine/scorer';
import { prisma } from '../core/prisma';
import { logger } from '../core/logger';
import { emitJobScored, emitNewJobs, emitScrapingStatus, emitScoringStatus } from '../core/socket';

// BullMQ connection config — use URL string to avoid ioredis version conflicts
const bullConnection = { url: config.REDIS_URL };

// ─── Queue Names ──────────────────────────────────────────────────────────────
export const QUEUE_NAMES = {
  SCRAPING: 'job-scraping',
  SCORING: 'job-scoring',
  RESUME: 'resume-compilation',
  RECALIBRATION: 'weight-recalibration',
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

export const resumeQueue = new Queue(QUEUE_NAMES.RESUME, {
  connection: bullConnection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 10,
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
  },
});

export const recalibrationQueue = new Queue(QUEUE_NAMES.RECALIBRATION, {
  connection: bullConnection,
  defaultJobOptions: {
    removeOnComplete: 5,
    removeOnFail: 5,
    attempts: 2,
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
    async (job: Job<{ targetScraperName?: string }>) => {
      const { targetScraperName } = job.data;
      emitScrapingStatus('running', { targetScraperName });
      
      try {
        logger.info(`🔍 Starting job scraping run...${targetScraperName ? ` for ${targetScraperName}` : ''}`);

        // Ensure profile embedding is ready before scoring
        await ensureProfileEmbedding();

        const { total, newJobs, scraperResults } = await runAllScrapers(targetScraperName);
        logger.info(`Scraping complete: ${total} fetched, ${newJobs} new jobs`, { scraperResults });

        if (newJobs > 0) {
          emitNewJobs(newJobs);
        }

        // Enqueue scoring for all NEW jobs atomically in batches of 3
        const result = await prisma.$queryRaw<{ id: string }[]>`
          UPDATE "Job"
          SET status = 'SCORING', "updatedAt" = NOW()
          WHERE status = 'NEW'
          RETURNING id
        `;
        const ids = result.map((r) => r.id);

        if (ids.length > 0) {
          const chunks: string[][] = [];
          for (let i = 0; i < ids.length; i += 3) {
            chunks.push(ids.slice(i, i + 3));
          }

          const scoringJobs = chunks.map((chunkIds) => ({
            name: 'score-job-batch',
            data: { jobIds: chunkIds },
            opts: {
              priority: 1,
              // Deterministic jobId prevents duplicate batch submissions (BullMQ dedup)
              jobId: `batch-${chunkIds[0]}-${chunkIds[chunkIds.length - 1]}`,
            },
          }));

          await scoringQueue.addBulk(scoringJobs);
          logger.info(`Enqueued ${scoringJobs.length} scoring job batches (total ${ids.length} jobs)`);
        }

        emitScrapingStatus('completed', { total, newJobs, scraperResults, targetScraperName });
        return { total, newJobs, scraperResults };
      } catch (err: any) {
        emitScrapingStatus('failed', { error: err.message, targetScraperName });
        throw err;
      }
    },
    { connection: bullConnection, concurrency: 1 }
  );
}

export function createScoringWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.SCORING,
    async (job: Job<{ jobId?: string; jobIds?: string[] }>) => {
      const { jobId, jobIds } = job.data;
      const idsToScore = jobIds && jobIds.length > 0 ? jobIds : jobId ? [jobId] : [];

      if (idsToScore.length === 0) {
        logger.warn('Scoring job had no job IDs');
        emitScoringStatus('idle');
        return { count: 0 };
      }

      emitScoringStatus('running', { count: idsToScore.length, jobIds: idsToScore });

      try {
        logger.info(`Scoring jobs batch of ${idsToScore.length}: ${idsToScore.join(', ')}...`);

        // Call scoreJobsBatch from scorer
        const results = await scoreJobsBatch(idsToScore);

        for (const res of results) {
          if (res.analysis) {
            emitJobScored(res.jobId, res.analysis.score, res.analysis);
          }
        }

        logger.info(`✅ Batch scoring completed for ${results.length} jobs`);
        emitScoringStatus('completed', { count: results.length, jobIds: idsToScore });
        return { count: results.length };
      } catch (err: any) {
        emitScoringStatus('failed', { error: err.message, jobIds: idsToScore });
        throw err;
      }
    },
    {
      connection: bullConnection,
      concurrency: 1,  // Rate limit: 15 RPM Gemini, serialize calls
    }
  );
}

export function createResumeWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.RESUME,
    async (job: Job<{ jobId: string }>) => {
      const { jobId } = job.data;
      logger.info(`Tailoring resume in background for job ${jobId}...`);
      const { compileTailoredResume } = require('../services/ai-engine/resumeCompiler');
      try {
        await compileTailoredResume(jobId);
        logger.info(`✅ Tailored resume background compilation completed for job ${jobId}`);
      } catch (err) {
        logger.error(`❌ Background resume compilation failed for job ${jobId}`, { error: err });
      }
      return { jobId };
    },
    { connection: bullConnection, concurrency: 1 }
  );
}

export function createRecalibrationWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.RECALIBRATION,
    async (job: Job) => {
      logger.info('Running adaptive weight recalibration job...');
      const { recalibrateWeights } = require('../services/ai-engine/feedback');
      await recalibrateWeights();
      return { success: true };
    },
    { connection: bullConnection, concurrency: 1 }
  );
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
export function setupGracefulShutdown(
  scrapingWorker: Worker,
  scoringWorker: Worker,
  resumeWorker: Worker,
  recalibrationWorker?: Worker
): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal} — gracefully shutting down workers...`);
    try {
      const workers = [scrapingWorker, scoringWorker, resumeWorker];
      if (recalibrationWorker) {
        workers.push(recalibrationWorker);
      }
      await Promise.all(workers.map(w => w.close()));
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
export async function triggerManualScrape(targetScraperName?: string): Promise<void> {
  await scrapingQueue.add('manual-scrape', { targetScraperName }, {
    priority: 1,
    jobId: `manual-${targetScraperName || 'all'}-${Date.now()}`,
  });
  logger.info(`Manual scrape triggered${targetScraperName ? ` for ${targetScraperName}` : ''}`);
}

export async function triggerJobScore(jobId: string): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { status: 'SCORING' } });
  // BullMQ deduplicates by jobId — second add for same job is a no-op
  await scoringQueue.add('score-job', { jobId }, { priority: 1, jobId: `score-${jobId}` });
  logger.info(`Manual score triggered for job ${jobId}`);
}

export async function triggerWeightRecalibration(): Promise<void> {
  // Use a singleton jobId to prevent multiple simultaneous recalibrations
  await recalibrationQueue.add('recalibrate-weights', {}, {
    priority: 3,
    jobId: 'recalibrate-singleton',
  });
  logger.info('Enqueued adaptive weight recalibration job');
}
