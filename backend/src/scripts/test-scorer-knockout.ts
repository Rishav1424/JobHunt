import { prisma } from '../core/prisma';
import { scoreJob } from '../services/ai-engine/scorer';
import { logger } from '../core/logger';

async function testKnockout() {
  logger.info('🚀 Starting Scorer Knockout Integration Test...');

  // 1. Senior Role Dummy Job
  const seniorJob = await prisma.job.create({
    data: {
      title: 'Senior Lead Backend Developer (6+ YOE)',
      company: 'High-Tech Corp',
      location: 'Bangalore, India',
      isRemote: false,
      description: 'Looking for a senior developer with at least 5 years of experience in distributed systems. Technical lead role.',
      url: 'https://example.com/senior-job',
      source: 'test',
      dedupeHash: 'senior-job-dedupe-hash-' + Date.now(),
      status: 'NEW',
    },
  });

  // 2. Low Pay Dummy Job
  const lowPayJob = await prisma.job.create({
    data: {
      title: 'Software Development Engineer',
      company: 'Small IT Services Ltd',
      location: 'Kolkata, India',
      isRemote: false,
      description: 'Fresher opening for SDE. Annual compensation is 6-8 LPA. Looking for enthusiastic graduates.',
      url: 'https://example.com/low-pay-job',
      source: 'test',
      dedupeHash: 'low-pay-job-dedupe-hash-' + Date.now(),
      status: 'NEW',
    },
  });

  logger.info(`Seeded dummy test jobs:\n- Senior Job: ID ${seniorJob.id}\n- Low Pay Job: ID ${lowPayJob.id}`);

  try {
    // Run score on senior job
    logger.info('Testing senior job knockout...');
    const result1 = await scoreJob(seniorJob.id);
    if (result1 && result1.score === 0) {
      logger.info('✅ Senior job knocked out successfully. Reason: ' + result1.whySkip);
    } else {
      logger.error('❌ Senior job knockout failed. Score: ' + (result1?.score ?? 'null'));
    }

    // Run score on low pay job
    logger.info('Testing low pay job knockout...');
    const result2 = await scoreJob(lowPayJob.id);
    if (result2 && result2.score === 0) {
      logger.info('✅ Low pay job knocked out successfully. Reason: ' + result2.whySkip);
    } else {
      logger.error('❌ Low pay job knockout failed. Score: ' + (result2?.score ?? 'null'));
    }
  } finally {
    // Cleanup dummy jobs
    await prisma.job.deleteMany({
      where: {
        id: { in: [seniorJob.id, lowPayJob.id] },
      },
    });
    logger.info('🧹 Cleaned up dummy test jobs.');
  }
}

testKnockout()
  .catch((err) => {
    logger.error('Test script failed', { error: err });
  })
  .finally(() => prisma.$disconnect());
