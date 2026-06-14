import { prisma } from '../core/prisma';

async function run() {
  const [total, statuses, topJobs, settings] = await Promise.all([
    prisma.job.count(),
    prisma.job.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.job.findMany({
      where: { fitScore: { gte: 70 } },
      select: { title: true, company: true, fitScore: true, source: true, status: true },
      orderBy: { fitScore: 'desc' },
      take: 10,
    }),
    prisma.settings.findFirst(),
  ]);

  const applications = await prisma.application.count();

  console.log('=== DB STATS ===');
  console.log('Total jobs:', total);
  console.log('Applications:', applications);
  statuses.forEach(s => console.log(`  ${s.status}: ${s._count.status}`));

  console.log('\n=== TOP MATCHING JOBS (70+) ===');
  console.log('Count:', topJobs.length);
  topJobs.forEach(j => console.log(`  [${j.fitScore}/100] ${j.title} @ ${j.company} (${j.source}) [${j.status}]`));

  if (settings) {
    console.log('\n=== SETTINGS ===');
    console.log('Min salary LPA:', settings.minSalaryLpa);
    console.log('Fit score threshold:', settings.fitScoreThreshold);
    console.log('Target roles:', settings.targetRoles);
    console.log('Scrape interval (hours):', settings.scrapeIntervalHours);
    console.log('Enabled sources:', settings.enabledSources);
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
