import { prisma } from '../core/prisma';
import { scoreJob, ensureProfileEmbedding } from '../services/ai-engine/scorer';
import { logger } from '../core/logger';

async function rescore() {
  logger.info('🚀 Starting rescore of failed jobs...');
  
  // Ensure profile embedding is present
  await ensureProfileEmbedding();

  const jobsToRescore = await prisma.job.findMany({
    where: {
      status: 'SCORED',
      fitScore: 0,
    },
    select: {
      id: true,
      title: true,
      company: true,
    },
  });

  logger.info(`Found ${jobsToRescore.length} jobs to rescore.`);

  // Let's rescore the first 10 jobs as a test first, or we can do a batch
  const limit = Math.min(jobsToRescore.length, 15);
  logger.info(`Rescoring first ${limit} jobs...`);

  for (let i = 0; i < limit; i++) {
    const job = jobsToRescore[i];
    logger.info(`[${i + 1}/${limit}] Rescoring job: ${job.title} at ${job.company} (ID: ${job.id})...`);
    try {
      const result = await scoreJob(job.id);
      if (result) {
        logger.info(`✅ Successfully scored: ${result.score}/100 - Verdict: ${result.verdict}`);
      } else {
        logger.warn(`⚠️ Rescore returned null for job ${job.id}`);
      }
    } catch (err) {
      logger.error(`❌ Failed to rescore job ${job.id}`, { err });
    }
    
    // Brief sleep to avoid hitting API rate limits too quickly
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  logger.info('🎉 Rescore run completed.');
}

rescore().catch(err => {
  logger.error('Rescore script failed', { err });
}).finally(() => {
  prisma.$disconnect();
});
