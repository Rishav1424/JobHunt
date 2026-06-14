import { scrapingQueue } from './queues';
import { prisma } from '../core/prisma';
import { logger } from '../core/logger';

/**
 * Start the periodic scraping schedule.
 * Reads interval from Settings table (default: every 6 hours).
 */
export async function startScheduler(): Promise<void> {
  const settings = await prisma.settings.findFirst();
  const intervalHours = settings?.scrapeIntervalHours ?? 6;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Remove existing repeatable jobs before adding new one
  const repeatableJobs = await scrapingQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await scrapingQueue.removeRepeatableByKey(job.key);
  }

  // Add repeatable scraping job
  await scrapingQueue.add(
    'scheduled-scrape',
    {},
    {
      repeat: { every: intervalMs },
      jobId: 'scheduled-scrape',
    }
  );

  logger.info(`📅 Scheduler started: scraping every ${intervalHours} hours`);

  // Also run immediately on startup if no recent scrape
  const lastScraped = settings?.lastScrapedAt;
  const hoursSinceLastScrape = lastScraped
    ? (Date.now() - lastScraped.getTime()) / (1000 * 60 * 60)
    : Infinity;

  if (hoursSinceLastScrape > intervalHours * 0.9) {
    logger.info('Running initial scrape on startup...');
    await scrapingQueue.add('startup-scrape', {}, { delay: 5000 }); // 5s delay to let server start
  }
}

/**
 * Update the scraping schedule (called from settings API).
 */
export async function updateSchedule(intervalHours: number): Promise<void> {
  const repeatableJobs = await scrapingQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await scrapingQueue.removeRepeatableByKey(job.key);
  }

  await scrapingQueue.add(
    'scheduled-scrape',
    {},
    {
      repeat: { every: intervalHours * 60 * 60 * 1000 },
      jobId: 'scheduled-scrape',
    }
  );

  logger.info(`Schedule updated: scraping every ${intervalHours} hours`);
}
