import { prisma } from '../core/prisma';
import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger';

async function seed() {
  logger.info('🌱 Seeding database...');

  // ── Settings ─────────────────────────────────────────────────────────────────
  const existingSettings = await prisma.settings.findFirst();
  if (!existingSettings) {
    await prisma.settings.create({
      data: {
        minSalaryLpa: 15,
        targetRoles: ['Software Development Engineer', 'Backend Engineer', 'Full Stack Engineer', 'SDE', 'SWE'],
        targetLocations: ['India', 'Remote'],
        remoteOnly: false,
        fitScoreThreshold: 65,
        scrapeIntervalHours: 6,
        enabledSources: { adzuna: true, remoteok: true, wellfound: true, instahyre: true, linkedin: true },
        blacklistedCompanies: [],
        targetCompanies: ['Google', 'Microsoft', 'Amazon', 'Meta', 'Flipkart', 'Zomato', 'Razorpay', 'CRED', 'Zepto', 'Meesho', 'Stripe'],
      },
    });
    logger.info('✅ Settings created');
  }

  // ── User Profile ──────────────────────────────────────────────────────────────
  const existingProfile = await prisma.userProfile.findFirst();
  if (!existingProfile) {
    // Try to load the base resume
    const resumePaths = [
      path.resolve(__dirname, '../../../BaseResume.latex'),
      path.resolve(__dirname, '../../BaseResume.latex'),
      '/app/BaseResume.latex',
    ];

    let baseResumeLatex = '% Paste your LaTeX resume here';
    for (const rPath of resumePaths) {
      if (fs.existsSync(rPath)) {
        baseResumeLatex = fs.readFileSync(rPath, 'utf-8');
        logger.info(`✅ Loaded resume from ${rPath}`);
        break;
      }
    }

    await prisma.userProfile.create({
      data: {
        name: 'Rishav Sharma',
        email: 'sharmarishav676@gmail.com',
        phone: '+91 7439497568',
        location: 'Kolkata, India',
        linkedinUrl: 'https://linkedin.com/in/rishav1424',
        githubUrl: 'https://github.com/rishav1424',
        baseResumeLatex,
        skills: [
          'Java', 'JavaScript', 'TypeScript', 'Python', 'C++', 'SQL',
          'Spring Boot', 'Node.js', 'React.js', 'Express.js', 'Django',
          'PostgreSQL', 'MongoDB', 'Redis', 'Docker', 'Git',
          'WebSocket', 'Socket.IO', 'REST APIs', 'Microservices',
          'System Design', 'DSA', 'OOP', 'DBMS', 'Computer Networks',
        ],
      },
    });
    logger.info('✅ User profile created (Rishav Sharma)');
  }

  logger.info('🌱 Seed complete!');
  await prisma.$disconnect();
}

seed().catch((err) => {
  logger.error('Seed failed', { err });
  process.exit(1);
});
