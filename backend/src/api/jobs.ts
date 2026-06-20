import { Router, Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { triggerManualScrape, triggerJobScore } from '../jobs/queues';
import { logger } from '../core/logger';
import { z } from 'zod';
import { recordApproval, recordSkip } from '../services/ai-engine/feedback';
import { getAllScraperHealth } from '../core/scraperHealth';

export const jobsRouter = Router();

const paramId = (req: Request, param: string): string =>
  Array.isArray(req.params[param]) ? req.params[param][0] : req.params[param] as string;

// GET /api/jobs — list jobs with filters
jobsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { status, source, minScore, page = '1', limit = '20', search } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (source) where.source = source;
    if (minScore) where.fitScore = { gte: parseFloat(minScore) };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10), 100);

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: [{ fitScore: 'desc' }, { scrapedAt: 'desc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: { application: { select: { status: true } } },
      }),
      prisma.job.count({ where }),
    ]);

    res.json({
      jobs,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    logger.error('GET /api/jobs error', { error });
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// GET /api/jobs/stats — dashboard stats
jobsRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [total, scored, approved, applied, today] = await Promise.all([
      prisma.job.count(),
      prisma.job.count({ where: { status: 'SCORED' } }),
      prisma.job.count({ where: { status: 'APPROVED' } }),
      prisma.job.count({ where: { status: 'APPLIED' } }),
      prisma.job.count({
        where: { scrapedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    const avgScore = await prisma.job.aggregate({
      _avg: { fitScore: true },
      where: { fitScore: { gte: 0 } }, // exclude -1 (failed) and null
    });

    const bySource = await prisma.job.groupBy({
      by: ['source'],
      _count: { source: true },
    });

    const topJobs = await prisma.job.findMany({
      where: { status: 'SCORED', fitScore: { gte: 70 } },
      orderBy: { fitScore: 'desc' },
      take: 5,
      select: { id: true, title: true, company: true, fitScore: true, source: true },
    });

    const scraperHealth = await getAllScraperHealth();

    res.json({
      total, scored, approved, applied, today,
      avgFitScore: Math.round(avgScore._avg.fitScore || 0),
      bySource: bySource.map((s) => ({ source: s.source, count: s._count.source })),
      topJobs,
      scraperHealth,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/jobs/health — queue and scraper health
jobsRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const scraperHealth = await getAllScraperHealth();
    const stuckJobs = await prisma.job.count({
      where: {
        status: 'SCORING',
        updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
      },
    });
    res.json({ scraperHealth, stuckJobs, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch health' });
  }
});

// GET /api/jobs/detect — find a job record by its application URL
jobsRouter.get('/detect', async (req: Request, res: Response) => {
  try {
    const { url } = req.query as { url: string };
    if (!url) return res.status(400).json({ error: 'URL query parameter is required' });

    const cleanUrl = url.split('?')[0];
    let job = await prisma.job.findFirst({
      where: {
        OR: [
          { url: { contains: cleanUrl } },
          { applyUrl: { contains: cleanUrl } },
          { url: { contains: url } },
        ],
      },
      include: { application: true },
    });

    if (!job) {
      // Fuzzy fallback: check company name in URL parts
      const parts = url.replace('https://', '').replace('http://', '').split('/');
      if (parts.length >= 2) {
        const companyPart = parts[1].toLowerCase();
        job = await prisma.job.findFirst({
          where: {
            company: { contains: companyPart, mode: 'insensitive' }
          },
          include: { application: true },
          orderBy: { scrapedAt: 'desc' }
        });
      }
    }

    if (!job) return res.status(404).json({ error: 'No matching job record found' });
    res.json(job);
  } catch (error) {
    logger.error('GET /api/jobs/detect error', { error });
    res.status(500).json({ error: 'Failed to detect job' });
  }
});

// GET /api/jobs/:id — get single job with full details
jobsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id as string },
      include: { application: true },
    });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// PATCH /api/jobs/bulk-status — bulk update status of multiple jobs
const bulkUpdateStatusSchema = z.object({
  ids: z.array(z.string()),
  status: z.enum(['APPROVED', 'SKIPPED', 'BLACKLISTED', 'REVIEWING']),
  whySkip: z.string().optional(),
  userComment: z.string().optional(),
});

jobsRouter.patch('/bulk-status', async (req: Request, res: Response) => {
  try {
    const { ids, status, whySkip, userComment } = bulkUpdateStatusSchema.parse(req.body);
    if (ids.length === 0) return res.json({ count: 0 });

    const jobsBefore = await prisma.job.findMany({ where: { id: { in: ids } } });

    // Update statuses in db
    const updatedResult = await prisma.job.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });

    // Run side-effects for each job
    for (const job of jobsBefore) {
      const analysis = job.fitAnalysis as any;

      if (status === 'APPROVED') {
        await recordApproval(
          job.title,
          job.company,
          job.fitScore || 0,
          analysis?.dimensions,
          analysis?.strengths || [],
          userComment
        );
        await prisma.application.upsert({
          where: { jobId: job.id },
          create: { jobId: job.id, status: 'PENDING' },
          update: {},
        });
        const { resumeQueue } = require('../../jobs/queues');
        resumeQueue.add('tailor-resume', { jobId: job.id }).catch((err: any) => {
          logger.error(`Failed to queue background resume compilation for job ${job.id}`, { error: err });
        });
      } else if (status === 'SKIPPED') {
        await recordSkip(
          job.title,
          job.company,
          job.fitScore || 0,
          analysis?.dimensions,
          analysis?.gaps || [],
          whySkip || analysis?.whySkip,
          userComment
        );
      } else if (status === 'BLACKLISTED') {
        await prisma.settings.updateMany({
          data: { blacklistedCompanies: { push: job.company } },
        });
      }
    }

    res.json({ count: updatedResult.count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    logger.error('PATCH /api/jobs/bulk-status error', { error });
    res.status(500).json({ error: 'Failed to bulk update status' });
  }
});

// PATCH /api/jobs/:id/status — update job status with feedback signals
const updateStatusSchema = z.object({
  status: z.enum(['APPROVED', 'SKIPPED', 'BLACKLISTED', 'REVIEWING']),
  whySkip: z.string().optional(),
  userComment: z.string().optional(),
});

jobsRouter.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, whySkip, userComment } = updateStatusSchema.parse(req.body);
    const jobId = paramId(req, 'id');

    const jobBefore = await prisma.job.findUnique({ where: { id: jobId } });
    if (!jobBefore) return res.status(404).json({ error: 'Job not found' });

    const job = await prisma.job.update({
      where: { id: jobId },
      data: { status },
    });

    // ── Record feedback signal ────────────────────────────────────────────
    const analysis = jobBefore.fitAnalysis as any;

    if (status === 'APPROVED') {
      await recordApproval(
        job.title,
        job.company,
        job.fitScore || 0,
        analysis?.dimensions,
        analysis?.strengths || [],
        userComment
      );
      // Create pending application record
      await prisma.application.upsert({
        where: { jobId },
        create: { jobId, status: 'PENDING' },
        update: {},
      });
      // Enqueue background resume compilation in the BullMQ queue
      const { resumeQueue } = require('../../jobs/queues');
      resumeQueue.add('tailor-resume', { jobId }).catch((err: any) => {
        logger.error(`Failed to queue background resume compilation for job ${jobId}`, { error: err });
      });
    } else if (status === 'SKIPPED') {
      await recordSkip(
        job.title,
        job.company,
        job.fitScore || 0,
        analysis?.dimensions,
        analysis?.gaps || [],
        whySkip || analysis?.whySkip,
        userComment
      );
    } else if (status === 'BLACKLISTED') {
      // Add company to blacklist in settings
      await prisma.settings.updateMany({
        data: { blacklistedCompanies: { push: job.company } },
      });
    }

    res.json(job);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    logger.error('PATCH /api/jobs/:id/status error', { error });
    res.status(500).json({ error: 'Failed to update job status' });
  }
});

// POST /api/jobs/scrape — trigger manual scrape
jobsRouter.post('/scrape', async (req: Request, res: Response) => {
  try {
    const { targetScraperName } = req.body || {};
    await triggerManualScrape(targetScraperName);
    res.json({ message: `Scraping started${targetScraperName ? ` for ${targetScraperName}` : ''}. Check Bull Board at :3001 for progress.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger scrape' });
  }
});

// POST /api/jobs/scrapers/:name/reset — reset circuit breaker for a specific scraper
jobsRouter.post('/scrapers/:name/reset', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { recordSuccess } = require('../core/scraperHealth');
    await recordSuccess(name);
    res.json({ message: `Circuit breaker reset for ${name}` });
  } catch (error) {
    logger.error(`Failed to reset circuit breaker for ${name}`, { error });
    res.status(500).json({ error: 'Failed to reset circuit breaker' });
  }
});

// GET /api/jobs/queues/status — get job counts for all BullMQ queues
jobsRouter.get('/queues/status', async (_req: Request, res: Response) => {
  try {
    const { scrapingQueue, scoringQueue, resumeQueue } = require('../jobs/queues');
    const [scrapingCounts, scoringCounts, resumeCounts] = await Promise.all([
      scrapingQueue.getJobCounts('wait', 'active', 'failed', 'completed', 'delayed', 'paused'),
      scoringQueue.getJobCounts('wait', 'active', 'failed', 'completed', 'delayed', 'paused'),
      resumeQueue.getJobCounts('wait', 'active', 'failed', 'completed', 'delayed', 'paused'),
    ]);
    res.json({
      queues: [
        { name: 'job-scraping', displayName: 'Scraping Queue', counts: scrapingCounts },
        { name: 'job-scoring', displayName: 'Scoring Queue', counts: scoringCounts },
        { name: 'resume-compilation', displayName: 'Resume Compilation Queue', counts: resumeCounts },
      ]
    });
  } catch (error) {
    logger.error('GET /api/jobs/queues/status error', { error });
    res.status(500).json({ error: 'Failed to fetch queue status' });
  }
});

// POST /api/jobs/queues/:name/drain — drain a specific BullMQ queue
jobsRouter.post('/queues/:name/drain', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { scrapingQueue, scoringQueue, resumeQueue } = require('../jobs/queues');
    let targetQueue;
    if (name === 'job-scraping') targetQueue = scrapingQueue;
    else if (name === 'job-scoring') targetQueue = scoringQueue;
    else if (name === 'resume-compilation') targetQueue = resumeQueue;

    if (!targetQueue) {
      return res.status(404).json({ error: 'Queue not found' });
    }

    await Promise.all([
      targetQueue.drain(true),
      targetQueue.clean(0, 0, 'completed'),
      targetQueue.clean(0, 0, 'failed'),
      targetQueue.clean(0, 0, 'active'),
    ]);

    res.json({ message: `Queue ${name} drained successfully` });
  } catch (error) {
    logger.error(`Failed to drain queue ${name}`, { error });
    res.status(500).json({ error: 'Failed to drain queue' });
  }
});

// POST /api/jobs/:id/score — manually rescore a job
jobsRouter.post('/:id/score', async (req: Request, res: Response) => {
  try {
    await triggerJobScore(paramId(req, 'id'));
    res.json({ message: 'Scoring queued' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger scoring' });
  }
});
