/**
 * Seed Rishav Sharma's profile and settings into the DB.
 * Run with: npm run db:seed
 */
import { prisma } from '../core/prisma';
import { logger } from '../core/logger';
import { generateEmbedding, proModel, parseGeminiJSON, callWithRetry } from '../core/gemini';
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

const BASE_RESUME_PATH = CANDIDATE_PATHS.find((p) => {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}) || '';
const baseResumeLatex = BASE_RESUME_PATH
  ? fs.readFileSync(BASE_RESUME_PATH, 'utf-8')
  : '% Resume not found — please add BaseResume.latex';

async function seed() {
  logger.info('🌱 Seeding database...');

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
      profileEmbedding: [],
      embeddingComputedAt: null,
      skills: [
        'Java', 'C', 'C++', 'Spring Boot', 'WebSockets', 'STOMP', 'Socket.IO', 'PostgreSQL',
        'Data Structures', 'Algorithms', 'OOP', 'System Design',
        'Node.js', 'Express.js', 'React', 'Redux', 'Redis', 'Python', 'Django',
        'Docker', 'Docker Compose', 'REST APIs', 'Prisma',
        'AWS', 'MongoDB', 'Linux', 'Git', 'Postman',
        'Distributed Systems', 'Real-time Systems', 'Microservices',
        'PTP', 'OPUS codec', 'FEC', 'Audio Engineering',
        'LeetCode', 'DSA', 'Competitive Programming',
      ],
    },
    update: {
      baseResumeLatex,
      profileEmbedding: [],
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

  logger.info(`✅ UserProfile upserted: ${profile.name} (${profile.email})`);
  logger.info(`   Resume: ${baseResumeLatex.length} bytes of LaTeX loaded`);

  // ── Parse & Seed KnowledgeChunks ─────────────────────────────────────────
  if (baseResumeLatex && !baseResumeLatex.startsWith('% Resume not found')) {
    logger.info('🧠 Parsing resume into KnowledgeChunks using Gemini...');
    const parserPrompt = `
You are an expert resume parser. Analyze the following LaTeX resume and break it down into a list of structured knowledge chunks representing projects, work experience, education, technical skills, and achievements.
For each chunk, output:
- category: "project" | "experience" | "technical_strength" | "education" | "other"
- title: A short string identifying the item (e.g. company name, project name, or degree). Null if not applicable.
- content: The content/bullet points of this item, converted to clean, readable markdown (no raw LaTeX tags like \\begin{itemize}, \\item, etc. - parse them into clean markdown bullet points or paragraphs). Include all key details, numbers, and technologies.

Resume LaTeX:
${baseResumeLatex}

Return a JSON array of objects with the fields: category, title, and content.
`;

    try {
      const response = await callWithRetry(async () => {
        const result = await proModel.generateContent(parserPrompt);
        return result.response.text();
      }, 3, 'parseResumeToChunks');

      interface ParsedChunk {
        category: string;
        title: string | null;
        content: string;
      }

      const parsedChunks = parseGeminiJSON<ParsedChunk[]>(response);
      logger.info(`   Parsed ${parsedChunks.length} chunks. Generating embeddings...`);

      // Clear existing chunks to avoid duplicates
      await prisma.knowledgeChunk.deleteMany();

      for (const chunk of parsedChunks) {
        logger.info(`   Generating embedding for: ${chunk.title || chunk.category}...`);
        const embedding = await generateEmbedding(chunk.content);
        const record = await prisma.knowledgeChunk.create({
          data: {
            category: chunk.category,
            title: chunk.title,
            content: chunk.content,
            embedding,
          },
        });

        // Sync pgvector column
        const vectorStr = `[${embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          'UPDATE "KnowledgeChunk" SET embedding_vec = cast($1 as vector) WHERE id = $2',
          vectorStr,
          record.id
        );
      }
      logger.info('✅ KnowledgeChunks seeded successfully!');
    } catch (err) {
      logger.error('❌ Failed to parse and seed KnowledgeChunks', { error: err });
    }
  } else {
    logger.warn('⚠️ Skipping KnowledgeChunk seeding: BaseResume.latex is not available or empty.');
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  const existingSettings = await prisma.settings.findFirst();

  const settingsData = {
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

    minSalaryLpa: 15,
    maxSalaryLpa: null,

    fitScoreThreshold: 65,

    scrapeIntervalHours: 6,

    enabledSources: {
      adzuna: true,
      remoteok: true,
      wellfound: true,
      instahyre: true,
      linkedin: true,
    },

    blacklistedCompanies: [
      'Infosys', 'Capgemini', 'Tech Mahindra', 'Mindtree', 'Mphasis',
      'Hexaware', 'NIIT Technologies', 'LTIMindtree', 'IBM India', 'HP India',
    ],

    targetCompanies: [
      'Google', 'Microsoft', 'Amazon', 'Meta', 'Apple',
      'Razorpay', 'CRED', 'Zepto', 'Meesho', 'Zomato', 'Swiggy',
      'Flipkart', 'PhonePe', 'Groww', 'ShareChat', 'BrowserStack',
      'Ola', 'Urban Company', 'Dunzo', 'Slice',
      'Atlassian', 'Uber', 'Stripe', 'Figma', 'Notion', 'Cloudflare',
      'Shopify', 'Datadog', 'HashiCorp',
    ],

    mncCompanies: [
      'Google', 'Microsoft', 'Amazon', 'Meta', 'Apple', 'Netflix', 'Oracle',
      'Adobe', 'Salesforce', 'Cisco', 'Stripe', 'Intel', 'AMD', 'NVIDIA',
      'Uber', 'Lyft', 'Atlassian', 'GitHub', 'Airbnb', 'Spotify', 'PayPal',
      'Zoom', 'Coinbase', 'Snowflake', 'Databricks', 'Honeywell', 'Samsung',
      'Goldman Sachs', 'Morgan Stanley', 'J.P. Morgan', 'JP Morgan', 'Walmart',
      'Figma', 'Notion', 'Cloudflare', 'Shopify', 'Datadog', 'HashiCorp'
    ],
    tier1Startups: [
      'Razorpay', 'CRED', 'Zepto', 'Meesho', 'Zomato', 'Swiggy', 'Flipkart',
      'PhonePe', 'Groww', 'ShareChat', 'BrowserStack', 'Ola', 'Urban Company',
      'Dunzo', 'Slice', 'InMobi', 'Paytm', 'Delhivery', 'Nykaa', 'Blinkit',
      'Ola Electric', 'Lenskart', 'Unacademy', 'UpGrad', 'Cars24', 'Byjus',
      'Swiggy Instamart', 'Pocket Aces', 'Postman', 'Hasura'
    ],
    serviceCompanies: [
      'Infosys', 'TCS', 'Tata Consultancy', 'Wipro', 'Capgemini', 'Accenture',
      'Cognizant', 'Tech Mahindra', 'HCL', 'Mindtree', 'LTIMindtree', 'Mphasis',
      'Hexaware', 'NIIT', 'IBM', 'HP', 'UST Global', 'CTS', 'EY', 'Deloitte',
      'PwC', 'KPMG', 'Genpact', 'Syntel', 'L&T Infotech', 'LTI'
    ],
    dimensionWeights: {
      techStack: 0.15,
      seniorityFit: 0.30,
      domainFit: 0.10,
      compensationFit: 0.25,
      companyTier: 0.20
    },
    minYoeCutoff: 3,
    minSalaryCutoff: 15,
  };

  if (existingSettings) {
    // Skip company list updates when a Settings row already exists
    const {
      blacklistedCompanies,
      targetCompanies,
      mncCompanies,
      tier1Startups,
      serviceCompanies,
      ...otherSettings
    } = settingsData;
    await prisma.settings.update({
      where: { id: existingSettings.id },
      data: otherSettings,
    });
  } else {
    await prisma.settings.create({ data: settingsData });
  }

  logger.info(`✅ Settings seeded:`);
  logger.info(`   Target roles: ${settingsData.targetRoles.length} roles`);
  logger.info(`   Dream companies: ${settingsData.targetCompanies.length} companies`);
  logger.info(`   Blacklisted: ${settingsData.blacklistedCompanies.length} companies`);
  logger.info(`   Min salary: ₹${settingsData.minSalaryLpa} LPA`);

  logger.info('🌱 Seed complete!');
}

seed()
  .catch((err) => {
    logger.error('Seed failed', { error: err });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
