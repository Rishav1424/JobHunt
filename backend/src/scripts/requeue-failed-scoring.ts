import { prisma } from '../core/prisma';
import { scoringQueue } from '../jobs/queues';
import { logger } from '../core/logger';

async function main() {
  logger.info('🔄 Starting re-queue of failed scoring jobs...');

  // 1. Reset user profile embedding to ensure it recomputes with the new model
  const profile = await prisma.userProfile.findFirst();
  if (profile) {
    await prisma.userProfile.update({
      where: { id: profile.id },
      data: {
        profileEmbedding: [],
        embeddingComputedAt: null,
      },
    });
    logger.info('✅ Reset user profile embedding for re-computation with gemini-embedding-001');
  }

  // 2. Find all jobs that failed scoring (fitScore = -1)
  const failedJobs = await prisma.job.findMany({
    where: { fitScore: -1 },
    select: { id: true, title: true, company: true },
  });

  if (failedJobs.length === 0) {
    logger.info('✅ No failed scoring jobs (fitScore = -1) found.');
    return;
  }

  logger.info(`Found ${failedJobs.length} failed jobs. Resetting status to SCORING and enqueuing...`);

  // 3. Reset database records to SCORING
  const ids = failedJobs.map((j) => j.id);
  await prisma.job.updateMany({
    where: { id: { in: ids } },
    data: {
      status: 'SCORING',
      fitScore: null,
    },
  });

  // 4. Enqueue to BullMQ
  const scoringJobs = failedJobs.map((j) => ({
    name: 'score-job',
    data: { jobId: j.id },
    opts: { priority: 1 },
  }));

  await scoringQueue.addBulk(scoringJobs);
  logger.info(`✅ Successfully enqueued ${failedJobs.length} jobs for scoring!`);
}

main()
  .catch((err) => logger.error('Failed to re-queue failed jobs', { error: err }))
  .finally(() => prisma.$disconnect());
