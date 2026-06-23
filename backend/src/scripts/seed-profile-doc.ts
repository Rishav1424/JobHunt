import { prisma } from '../core/prisma';
import { logger } from '../core/logger';
import { generateEmbedding, proModel } from '../core/gemini';
import { redis } from '../core/redis';
import fs from 'fs';
import path from 'path';

// Find ProfileData.md path
const rootDir = path.resolve(__dirname, '../../..');
const profileDataPath = path.join(rootDir, 'ProfileData.md');

// Load LaTeX Resume
const BASE_RESUME_PATH = path.join(rootDir, 'BaseResume.latex');
const baseResumeLatex = fs.existsSync(BASE_RESUME_PATH)
  ? fs.readFileSync(BASE_RESUME_PATH, 'utf-8')
  : '% Resume not found — please add BaseResume.latex';

async function main() {
  logger.info('🌱 Starting Profile Document Ingestion...');

  if (!fs.existsSync(profileDataPath)) {
    throw new Error(`ProfileData.md not found at ${profileDataPath}`);
  }

  const content = fs.readFileSync(profileDataPath, 'utf-8');

  // Split by SECTION H2 headers
  const lines = content.split('\n');
  const sections: { num: number; title: string; body: string }[] = [];
  let currentSectionNum = 0;
  let currentSectionTitle = '';
  let currentSectionLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## SECTION ')) {
      if (currentSectionNum > 0) {
        sections.push({
          num: currentSectionNum,
          title: currentSectionTitle,
          body: currentSectionLines.join('\n').trim()
        });
      }
      const match = line.match(/^## SECTION (\d+):\s*(.*?)$/);
      if (match) {
        currentSectionNum = parseInt(match[1], 10);
        currentSectionTitle = match[2];
      } else {
        currentSectionNum = 0;
      }
      currentSectionLines = [];
    } else if (currentSectionNum > 0) {
      currentSectionLines.push(line);
    }
  }
  if (currentSectionNum > 0) {
    sections.push({
      num: currentSectionNum,
      title: currentSectionTitle,
      body: currentSectionLines.join('\n').trim()
    });
  }

  logger.info(`Parsed ${sections.length} sections from ProfileData.md`);

  // ── 1. Parse SECTION 1: Static Facts ──────────────────────────────────────
  const facts: Record<string, string> = {};
  const factsBody = sections.find(s => s.num === 1)?.body || '';
  factsBody.split('\n').forEach(line => {
    const match = line.match(/^\*\s*(.*?):\s*(.*)$/);
    if (match) {
      facts[match[1].trim()] = match[2].trim();
    }
  });

  // ── 2. Parse SECTION 2: Education ─────────────────────────────────────────
  const edu: Record<string, string> = {};
  const eduBody = sections.find(s => s.num === 2)?.body || '';
  eduBody.split('\n').forEach(line => {
    const match = line.match(/^\*\s*(.*?):\s*(.*)$/);
    if (match) {
      edu[match[1].trim()] = match[2].trim();
    }
  });

  // ── 3. Parse SECTION 3: Skills ────────────────────────────────────────────
  const skillsList: { name: string; level: string; context: string }[] = [];
  const skillsArray: string[] = [];
  const skillsBody = sections.find(s => s.num === 3)?.body || '';
  skillsBody.split('\n').forEach(line => {
    const match = line.match(/^\*\s*\*\*(.*?)\s*\((Strong|Comfortable|Familiar)\)\*\*:\s*(.*)$/i);
    if (match) {
      const category = match[1].trim();
      const level = match[2].toLowerCase();
      const context = match[3].trim();
      skillsList.push({ name: category, level, context });
      
      const subSkills = context.split(/,\s*(?![^()]*\))/g);
      subSkills.forEach(sub => {
        const nameMatch = sub.match(/^([^(]+)/);
        if (nameMatch) {
          const name = nameMatch[1].trim();
          if (name && !skillsArray.includes(name)) {
            skillsArray.push(name);
          }
        }
      });
    }
  });

  // ── 4. Construct UserProfile and profileJson ──────────────────────────────
  const name = facts['Full Name'] || 'Rishav Sharma';
  const email = facts['Email'] || 'sharmarishav676@gmail.com';
  const phone = facts['Phone'] || '+91 7439497568';
  const location = facts['Location'] || 'Kolkata, India';
  const linkedinUrl = facts['LinkedIn'] || 'https://linkedin.com/in/rishav1424';
  const githubUrl = facts['GitHub'] || 'https://github.com/rishav1424';

  const profileJson = {
    facts: {
      name,
      email,
      phone,
      location,
      graduationDate: edu['Graduation Year'] || '2026',
      college: edu['University'] || 'National Institute of Technology (NIT), Durgapur',
      degree: edu['Degree'] || 'Bachelor of Technology (B.Tech)',
      cgpa: edu['CGPA'] || '7.5 / 10',
      currentRole: `${facts['Current Title']} at ${facts['Current Employer']}`,
      noticePeriod: facts['Notice Period'] || '0 days',
    },
    skills: skillsList,
    preferences: {
      rolePreferences: {
        primary: ['Backend Engineer', 'SDE', 'Distributed Systems', 'Software Engineer'],
        avoid: ['Frontend-only', 'Mobile', 'ML/AI', 'QA', 'DevOps'],
      },
      domainInterests: ['fintech infrastructure', 'real-time systems', 'developer tools', 'distributed databases'],
      dealBreakers: ['pure QA role', 'no backend component', 'WITCH companies'],
    },
    competitiveEdge: edu['Distinction'] || 'JEE Advanced Top 1%',
    careerGoals: 'Solve complex performance, concurrency, and scaling systems problems.',
  };

  // Upsert Profile
  logger.info(`Upserting UserProfile: ${name}`);
  const profileRecord = await prisma.userProfile.upsert({
    where: { id: 'rishav-profile' },
    create: {
      id: 'rishav-profile',
      name,
      email,
      phone,
      location,
      linkedinUrl,
      githubUrl,
      baseResumeLatex,
      baseResumePath: '../BaseResume.latex',
      profileEmbedding: [],
      skills: skillsArray,
      profileJson: profileJson as any,
      skillsEmbedding: [],
      systemsEmbedding: [],
      webEmbedding: [],
      projectEmbedding: [],
    },
    update: {
      name,
      email,
      phone,
      location,
      linkedinUrl,
      githubUrl,
      baseResumeLatex,
      skills: skillsArray,
      profileJson: profileJson as any,
    },
  });

  // Re-generate profile and section embeddings
  logger.info('Generating profile section embeddings...');
  const skillsText = skillsBody;
  const systemsText = sections.find(s => s.num === 4)?.body || '';
  const webText = sections.find(s => s.num === 5)?.body || '';
  const projectsText = sections.find(s => s.num === 5)?.body || '';

  const [profileEmb, skillsEmb, systemsEmb, webEmb, projectsEmb] = await Promise.all([
    generateEmbedding(`${name} profile. ${skillsArray.join(', ')}`),
    generateEmbedding(skillsText || 'No skills experience.'),
    generateEmbedding(systemsText || 'No systems experience.'),
    generateEmbedding(webText || 'No web experience.'),
    generateEmbedding(projectsText || 'No projects experience.'),
  ]);

  await prisma.userProfile.update({
    where: { id: profileRecord.id },
    data: {
      profileEmbedding: profileEmb,
      skillsEmbedding: skillsEmb,
      systemsEmbedding: systemsEmb,
      webEmbedding: webEmb,
      projectEmbedding: projectsEmb,
      embeddingComputedAt: new Date(),
    },
  });

  // Sync profile pgvector column
  const profileVectorStr = `[${profileEmb.join(',')}]`;
  await prisma.$executeRawUnsafe(
    'UPDATE "UserProfile" SET profile_embedding_vec = cast($1 as vector) WHERE id = $2',
    profileVectorStr,
    profileRecord.id
  );

  // ── 5. Generate Knowledge Chunks ──────────────────────────────────────────
  logger.info('Re-seeding Knowledge Chunks from ProfileData.md...');
  await prisma.knowledgeChunk.deleteMany();

  const chunksToCreate: { category: string; title: string; content: string }[] = [];

  // Add Section 2 (Education)
  chunksToCreate.push({
    category: 'education',
    title: 'NIT Durgapur Education',
    content: sections.find(s => s.num === 2)?.body || '',
  });

  // Add Section 3 (Skills)
  chunksToCreate.push({
    category: 'technical_strength',
    title: 'Technical Arsenal & Skills',
    content: skillsBody,
  });

  // Add Section 4 (Work Experience)
  const workBody = sections.find(s => s.num === 4)?.body || '';
  const workItems = workBody.split(/^###\s+/m).filter(Boolean);
  workItems.forEach(item => {
    const lines = item.split('\n');
    const title = lines[0].trim();
    chunksToCreate.push({
      category: 'experience',
      title,
      content: item.trim(),
    });
  });

  // Add Section 5 (Projects)
  const projBody = sections.find(s => s.num === 5)?.body || '';
  const projItems = projBody.split(/^###\s+/m).filter(Boolean);
  projItems.forEach(item => {
    const lines = item.split('\n');
    const title = lines[0].trim();
    chunksToCreate.push({
      category: 'project',
      title,
      content: item.trim(),
    });
  });

  // Add Section 6 (Behavioral Story Bank)
  const behBody = sections.find(s => s.num === 6)?.body || '';
  const behItems = behBody.split(/^###\s+/m).filter(Boolean);
  behItems.forEach(item => {
    const lines = item.split('\n');
    const title = lines[0].trim();
    chunksToCreate.push({
      category: 'behavioral',
      title,
      content: item.trim(),
    });
  });

  // Add Section 7 (Career Narrative)
  chunksToCreate.push({
    category: 'career_narrative',
    title: 'Career Narrative & Elevator Pitch',
    content: sections.find(s => s.num === 7)?.body || '',
  });

  // Add Section 8 (Company Motivation)
  chunksToCreate.push({
    category: 'company_motivation',
    title: 'Company Motivations',
    content: sections.find(s => s.num === 8)?.body || '',
  });

  // Add Section 9 (Opinions & Preferences)
  chunksToCreate.push({
    category: 'opinions',
    title: 'Preferences & Opinions',
    content: sections.find(s => s.num === 9)?.body || '',
  });

  // Bulk embed and create KnowledgeChunks in parallel batches of 5
  logger.info(`Creating ${chunksToCreate.length} knowledge chunks...`);
  const BATCH_SIZE = 5;
  for (let i = 0; i < chunksToCreate.length; i += BATCH_SIZE) {
    const batch = chunksToCreate.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (c) => {
        const embedding = await generateEmbedding(c.content);
        const record = await prisma.knowledgeChunk.create({
          data: {
            category: c.category,
            title: c.title,
            content: c.content,
            embedding,
          },
        });
        const vectorStr = `[${embedding.join(',')}]`;
        await prisma.$executeRawUnsafe(
          'UPDATE "KnowledgeChunk" SET embedding_vec = cast($1 as vector) WHERE id = $2',
          vectorStr,
          record.id
        );
      })
    );
  }
  logger.info('✅ Knowledge chunks seeded');

  // ── 6. Seed AnswerBank (Section 10 Q&As) ──────────────────────────────────
  logger.info('Seeding AnswerBank Q&A pairs...');
  // Delete general Q&A pairs (where company = '')
  await prisma.answerBank.deleteMany({ where: { company: '' } });

  const qaBody = sections.find(s => s.num === 10)?.body || '';
  const qaBlocks = qaBody.split(/\*\*Q:\s*/i).filter(Boolean);
  const qaPairs: { question: string; answer: string }[] = [];
  
  qaBlocks.forEach(block => {
    const parts = block.split(/\r?\nA:\s*/i);
    if (parts.length === 2) {
      const question = parts[0].replace(/\*\*/g, '').trim();
      const answer = parts[1].trim();
      qaPairs.push({ question, answer });
    }
  });

  logger.info(`Creating ${qaPairs.length} AnswerBank entries...`);
  for (const pair of qaPairs) {
    const embedding = await generateEmbedding(pair.question);
    const record = await prisma.answerBank.create({
      data: {
        question: pair.question,
        company: '',
        answer: pair.answer,
        embedding,
      },
    });
    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRawUnsafe(
      'UPDATE "AnswerBank" SET embedding_vec = cast($1 as vector) WHERE id = $2',
      vectorStr,
      record.id
    );
  }
  logger.info('✅ AnswerBank Q&A pairs seeded');

  // Invalidate Redis Candidate context
  await redis.del('candidate:rich_context');
  logger.info('🧹 Candidate rich context cache invalidated in Redis.');

  logger.info('🎉 Profile Document Seeding completed successfully!');
}

main()
  .catch((err) => {
    logger.error('Seeding Profile Document failed', { error: err });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
