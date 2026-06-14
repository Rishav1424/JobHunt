import { prisma } from '../core/prisma';
import { scoringQueue } from '../jobs/queues';
import { logger } from '../core/logger';
import { Prisma } from '@prisma/client';

async function requeue() {
  logger.info('🚀 Resetting and requeuing scored jobs for scoring...');

  // Find all jobs that are currently SCORED (meaning they were scored previously with score 0 or fallback)
  const jobsToRequeue = await prisma.job.findMany({
    where: {
      status: 'SCORED',
    },
    select: {
      id: true,
      title: true,
      company: true,
    },
  });

  logger.info(`Found ${jobsToRequeue.length} jobs to requeue.`);

  if (jobsToRequeue.length === 0) {
    logger.info('No jobs to requeue.');
    return;
  }

  // Update status to SCORING, reset fitScore and fitAnalysis
  const jobIds = jobsToRequeue.map(j => j.id);
  await prisma.job.updateMany({
    where: {
      id: { in: jobIds },
    },
    data: {
      status: 'SCORING',
      fitScore: null,
      fitAnalysis: Prisma.DbNull,
      scoredAt: null,
    },
  });

  logger.info(`Updated database status to 'SCORING' for ${jobIds.length} jobs.`);

  // Add all of them to the BullMQ scoring queue
  const scoringJobs = jobsToRequeue.map((j) => ({
    name: 'score-job',
    data: { jobId: j.id },
    opts: { priority: 1 },
  }));

  // We can add them in batches of 50 to avoid any BullMQ bulk limits
  const batchSize = 50;
  for (let i = 0; i < scoringJobs.length; i += batchSize) {
    const batch = scoringJobs.slice(i, i + batchSize);
    await scoringQueue.addBulk(batch);
    logger.info(`Enqueued batch of ${batch.length} jobs to scoring queue (${i + batch.length}/${scoringJobs.length}).`);
  }

  logger.info('🎉 Requeuing complete. BullMQ worker should now start scoring them automatically!');
}

requeue().catch(err => {
  logger.error('Requeue script failed', { err });
}).finally(async () => {
  // Let BullMQ connection close
  await scoringQueue.close();
  await prisma.$disconnect();
});
