/**
 * Seed Rishav Sharma's profile into the DB.
 * Run once: docker compose exec backend npx tsx src/scripts/seed-profile.ts
 *
 * This populates:
 * 1. UserProfile — full resume LaTeX, skills, personal info
 * 2. Settings — target roles, companies, salary filter, sources
 */
import { prisma } from '../core/prisma';
import { logger } from '../core/logger';
import fs from 'fs';
import path from 'path';

// The resume is mounted at /app/BaseResume.latex in Docker
// Try multiple candidate paths to handle both Docker and local dev
const CANDIDATE_PATHS = [
  '/app/BaseResume.latex',                                           // Docker mount
  path.resolve(process.cwd(), 'BaseResume.latex'),                  // CWD (local dev)
  path.resolve(__dirname, '../../../BaseResume.latex'),              // relative from src/scripts/
  path.resolve(__dirname, '../../BaseResume.latex'),                 // fallback
];

const BASE_RESUME_PATH = CANDIDATE_PATHS.find(fs.existsSync) || '';
const baseResumeLatex = BASE_RESUME_PATH
  ? fs.readFileSync(BASE_RESUME_PATH, 'utf-8')
  : '% Resume not found — please add BaseResume.latex';

async function seedProfile() {
  logger.info('🌱 Seeding Rishav Sharma profile...');

  // ── UserProfile ──────────────────────────────────────────────────────────
  const profile = await prisma.userProfile.upsert({
    where: { id: 'rishav-profile' },
    create: {
      id: 'rishav-profile',
      name: 'Rishav Sharma',
      email: 'sharmarishav676@gmail.com',
      phone: '+91 7439497568',
      location: 'Kolkata, India',
      linkedinUrl: 'https://linkedin.com/in/rishav1424',
      githubUrl: 'https://github.com/rishav1424',
      baseResumeLatex,
      baseResumePath: '../BaseResume.latex',
      profileEmbedding: [],   // will be computed on first scrape run
      embeddingComputedAt: null,
      skills: [
        // Strong
        'Java', 'C', 'C++', 'Spring Boot', 'WebSockets', 'STOMP', 'Socket.IO', 'PostgreSQL',
        'Data Structures', 'Algorithms', 'OOP', 'System Design',
        // Comfortable
        'Node.js', 'Express.js', 'React', 'Redux', 'Redis', 'Python', 'Django',
        'Docker', 'Docker Compose', 'REST APIs', 'Prisma',
        // Familiar
        'AWS', 'MongoDB', 'Linux', 'Git', 'Postman',
        // Domain
        'Distributed Systems', 'Real-time Systems', 'Microservices',
        'PTP', 'OPUS codec', 'FEC', 'Audio Engineering',
        // Competitive Programming
        'LeetCode', 'DSA', 'Competitive Programming',
      ],
    },
    update: {
      baseResumeLatex,
      profileEmbedding: [],   // reset embedding so it gets recomputed with new resume
      embeddingComputedAt: null,
      skills: [
        'Java', 'C', 'C++', 'Spring Boot', 'WebSockets', 'STOMP', 'Socket.IO', 'PostgreSQL',
        'Data Structures', 'Algorithms', 'OOP', 'System Design',
        'Node.js', 'Express.js', 'React', 'Redux', 'Redis', 'Python', 'Django',
        'Docker', 'Docker Compose', 'REST APIs', 'Prisma',
        'AWS', 'MongoDB', 'Linux', 'Git',
        'Distributed Systems', 'Real-time Systems', 'Microservices',
        'LeetCode', 'DSA', 'Competitive Programming',
      ],
    },
  });

  logger.info(`✅ UserProfile seeded: ${profile.name} (${profile.email})`);
  logger.info(`   Resume: ${baseResumeLatex.length} bytes of LaTeX loaded`);

  // ── Settings ─────────────────────────────────────────────────────────────
  const existingSettings = await prisma.settings.findFirst();

  const settingsData = {
    // Target roles — what to search for across all scrapers
    targetRoles: [
      'Software Development Engineer',
      'Backend Engineer',
      'Backend Developer',
      'Full Stack Engineer',
      'Full Stack Developer',
      'Software Engineer',
      'SDE',
      'SWE',
      'Node.js Developer',
      'Java Developer',
      'Spring Boot Developer',
    ],
    targetLocations: ['India', 'Bangalore', 'Mumbai', 'Hyderabad', 'Pune', 'Delhi', 'Noida', 'Gurgaon', 'Remote'],
    remoteOnly: false,

    // Salary — minimum 15 LPA, filter out confirmed < 12 LPA
    minSalaryLpa: 15,
    maxSalaryLpa: null,

    // Score threshold — only show 65+ on dashboard by default
    fitScoreThreshold: 65,

    // Scrape every 6 hours
    scrapeIntervalHours: 6,

    // All sources enabled
    enabledSources: {
      adzuna: true,
      remoteok: true,
      wellfound: true,
      instahyre: true,
      linkedin: true,
    },

    // Companies to auto-blacklist (IT services / consulting / outsourcing)
    blacklistedCompanies: [
      'Infosys', 'Capgemini', 'Tech Mahindra', 'Mindtree', 'Mphasis',
      'Hexaware', 'NIIT Technologies', 'LTIMindtree', 'IBM India', 'HP India',
    ],

    // Dream companies — scored higher by the AI
    targetCompanies: [
      // FAANG
      'Google', 'Microsoft', 'Amazon', 'Meta', 'Apple',
      // Top Indian funded startups
      'Razorpay', 'CRED', 'Zepto', 'Meesho', 'Zomato', 'Swiggy',
      'Flipkart', 'PhonePe', 'Groww', 'ShareChat', 'BrowserStack',
      'Ola', 'Urban Company', 'Dunzo', 'Slice',
      // Global product companies
      'Atlassian', 'Uber', 'Stripe', 'Figma', 'Notion', 'Cloudflare',
      'Shopify', 'Datadog', 'HashiCorp',
    ],
  };

  if (existingSettings) {
    await prisma.settings.update({
      where: { id: existingSettings.id },
      data: settingsData,
    });
  } else {
    await prisma.settings.create({ data: settingsData });
  }

  logger.info(`✅ Settings seeded:`);
  logger.info(`   Target roles: ${settingsData.targetRoles.length} roles`);
  logger.info(`   Dream companies: ${settingsData.targetCompanies.length} companies`);
  logger.info(`   Blacklisted: ${settingsData.blacklistedCompanies.length} companies`);
  logger.info(`   Min salary: ₹${settingsData.minSalaryLpa} LPA`);

  logger.info('\n✅ Profile seeding complete! Run a scrape to start scoring with your personalized profile.');
}

seedProfile()
  .catch((err) => {
    logger.error('Seeding failed', { error: err });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
