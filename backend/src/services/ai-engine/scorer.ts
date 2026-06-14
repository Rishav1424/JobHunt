import { flashModel, generateEmbedding, parseGeminiJSON, cosineSimilarity, callWithRetry } from '../../core/gemini';
import { prisma } from '../../core/prisma';
import { logger } from '../../core/logger';
import { getFeedbackCalibration } from './feedback';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DimensionScores {
  techStack: number;       // 0-100: Tech overlap between JD and candidate
  seniorityFit: number;    // 0-100: Experience level match (fresh grad vs required YOE)
  domainFit: number;       // 0-100: Backend/SDE vs unrelated domain
  compensationFit: number; // 0-100: Salary match vs ₹15 LPA minimum
  companyTier: number;     // 0-100: Company prestige/engineering culture
}

export interface FitAnalysis {
  score: number;                   // 0-100 composite
  dimensions: DimensionScores;     // dimensional breakdown
  verdict: string;                 // 'Strong Match' | 'Good Match' | 'Partial Match' | 'Weak Match'
  strengths: string[];             // your specific skills that match this JD
  gaps: string[];                  // what the JD wants that you're weak on
  reasons: string[];               // detailed bullet explanations
  whyApply: string;                // 1-2 sentences: strongest case FOR applying
  whySkip: string;                 // 1-2 sentences: biggest concern AGAINST applying
  salaryEstimate?: string;         // Gemini's inferred CTC if not in listing
  keywordsMatched: string[];       // ATS-critical keywords from JD in your profile
  recommendation: string;          // one actionable sentence
  isTargetCompany?: boolean;       // true if company is on dream list
  prescreenPassed: boolean;        // false = skipped Gemini (pre-screened out)
}

// ─── Candidate Profile (baked in, from PersonalData.md) ──────────────────────
// This is the authoritative description of Rishav used in EVERY scoring prompt.
// Update this when experience changes.
const CANDIDATE_PROFILE = `
## Candidate: Rishav Sharma (Fresh Graduate, NIT Durgapur, B.Tech EE, June 2026)

### Current Experience
- **SDE Intern @ Samsung R&D Institute India (SRID), Noida** (Jan 2026–Present)
  - Implemented PTP (Precision Time Protocol) for sub-5μs clock synchronization across multi-device audio mesh
  - Integrated OPUS codec reducing bandwidth by ~40% while maintaining audio fidelity
  - Engineered FEC (Forward Error Correction) layer: zero-dropout audio under 15% simulated packet loss
  - Domain: Distributed real-time systems, low-latency audio engineering, fault-tolerant protocol design

### Technical Stack (Honest Self-Assessment)
- **Strong (production-proven):** Java, C/C++, Spring Boot, WebSockets (STOMP), Socket.IO, PostgreSQL, DSA
- **Comfortable (multiple projects):** Node.js, React, Redis (Pub/Sub + RedisTemplate), Python, Django, Docker
- **Familiar:** AWS (basic), MongoDB, Linux/embedded, Prisma ORM

### Key Projects
1. **Distributed Chess Platform** (Spring Boot, Redis Pub/Sub, WebSocket/STOMP, Docker)
   - Microservices backend, sub-100ms round-trip move sync
   - Redis Pub/Sub for horizontal scaling, sub-10ms session failover
   - Live: chessclient.onrender.com

2. **CampusCord** (Node.js, React, Socket.IO, PostgreSQL, Prisma)
   - 500+ concurrent users, sub-50ms message delivery
   - RBAC + JWT auth, 60% query optimization via PostgreSQL indexing

3. **E-Summit Platform** (Django, PostgreSQL)
   - 5,000+ concurrent users, REST APIs <100ms under peak load
   - QR Hunt gamification engine

### Academic & Competitive Credentials
- JEE Advanced 2022: AIR 10,648 — Top 1% of 1M+ candidates
- LeetCode: 500+ problems (250+ medium, 100+ hard), rating 1600+
- CodeChef Starters 133 Div 2: Global Rank 843 / 15,000+
- Web Dev Head @ EDC NIT Durgapur — led 25-member team, Eastern India's largest E-Summit

### Preferences
- Target: Backend Engineering, Distributed Systems, Core SDE
- Willing: Full-time FTE or Internship-to-PPO
- Minimum Salary: ₹15 LPA CTC
- Ideal Range: ₹20-30+ LPA
`.trim();

// ─── Dream Companies (scored higher automatically) ────────────────────────────
const DREAM_COMPANIES = [
  'google', 'microsoft', 'amazon', 'meta', 'apple',
  'razorpay', 'cred', 'zepto', 'meesho', 'zomato', 'swiggy',
  'atlassian', 'uber', 'stripe', 'figma', 'notion', 'cloudflare',
  'flipkart', 'phonepe', 'groww', 'sharechat', 'browserstack',
  'openai', 'anthropic', 'cohere', 'databricks',
];

// ─── Pre-screening (avoid wasting Gemini tokens) ─────────────────────────────
const PRESCREEN_SKIP_TITLES = [
  /\bdata.?scientist\b/i, /\bdata.?analyst\b/i, /\bmachine.?learning\b/i,
  /\bml.?engineer\b/i, /\bai.?engineer\b/i, /\bdevops\b/i, /\bsre\b/i,
  /\bsite.?reliability\b/i, /\bqa.?engineer\b/i, /\bembedded\b/i,
  /\bfirmware\b/i, /\bmobile.?develop\b/i, /\bios.?develop\b/i,
  /\bandroid.?develop\b/i, /\bflutter\b/i, /\breact.?native\b/i,
  /\bmarketing\b/i, /\bsales\b/i, /\bproduct.?manager\b/i,
  /\bsupport.?engineer\b/i, /\btest.?engineer\b/i,
];

function shouldPrescreen(title: string): boolean {
  return PRESCREEN_SKIP_TITLES.some((p) => p.test(title));
}

function isDreamCompany(company: string): boolean {
  const lower = company.toLowerCase();
  return DREAM_COMPANIES.some((d) => lower.includes(d));
}

// ─── Main Scoring Function ────────────────────────────────────────────────────

export async function scoreJob(jobId: string): Promise<FitAnalysis | null> {
  try {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return null;

    const isTargetCompany = isDreamCompany(job.company);

    // ── Pre-screening: Skip Gemini for clearly irrelevant roles ──────────
    if (shouldPrescreen(job.title) && !isTargetCompany) {
      logger.info(`Pre-screened out: "${job.title}" @ ${job.company}`);
      const zeroAnalysis: FitAnalysis = {
        score: 0,
        dimensions: { techStack: 0, seniorityFit: 0, domainFit: 0, compensationFit: 0, companyTier: 0 },
        verdict: 'Weak Match',
        strengths: [],
        gaps: ['Role type does not match target profile (Backend/SDE/FS)'],
        reasons: ['Pre-screened: job domain does not match candidate target'],
        whyApply: 'Not applicable — domain mismatch',
        whySkip: `This is a ${job.title} role. Target is Backend/SDE/Full-Stack.`,
        keywordsMatched: [],
        recommendation: 'Skip — domain mismatch',
        isTargetCompany: false,
        prescreenPassed: false,
      };
      await prisma.job.update({
        where: { id: jobId },
        data: { fitScore: 0, fitAnalysis: zeroAnalysis as unknown as import('@prisma/client').Prisma.InputJsonValue, status: 'SCORED', scoredAt: new Date() },
      });
      return zeroAnalysis;
    }

    // ── Step 1: Embedding similarity (fast, no Gemini quota) ─────────────
    let embeddingScore = 50; // default if no profile embedding
    let jobEmbedding = job.embedding;

    const profile = await prisma.userProfile.findFirst();
    if (profile && profile.profileEmbedding.length > 0) {
      if (!jobEmbedding || jobEmbedding.length === 0) {
        const jdText = `${job.title} at ${job.company}\n\n${job.description}`;
        jobEmbedding = await generateEmbedding(jdText.slice(0, 8000));
        await prisma.job.update({ where: { id: jobId }, data: { embedding: jobEmbedding } });
      }
      const rawSimilarity = cosineSimilarity(profile.profileEmbedding, jobEmbedding);
      // Normalize: cosine similarity for good matches typically 0.4–0.9, scale to 0-100
      embeddingScore = Math.round(Math.max(0, Math.min(1, (rawSimilarity - 0.2) / 0.7)) * 100);
    }

    // ── Step 2: Feedback calibration (learns from your approvals/skips) ──
    const calibration = await getFeedbackCalibration();

    // ── Step 3: Gemini multi-dimensional analysis ─────────────────────────
    const prompt = buildScoringPrompt(job.title, job.company, job.description, job.salaryRaw, embeddingScore, calibration, isTargetCompany);

    const result = await callWithRetry(
      () => flashModel.generateContent(prompt),
      4,
      `scoreJob:${job.title}@${job.company}`
    );

    let analysis: FitAnalysis;
    try {
      const raw = parseGeminiJSON<Omit<FitAnalysis, 'prescreenPassed' | 'isTargetCompany'>>(result.response.text());
      analysis = {
        ...raw,
        prescreenPassed: true,
        isTargetCompany,
        // If it's a dream company, give a floor boost of +10
        score: isTargetCompany ? Math.min(100, Math.round(raw.score) + 10) : Math.min(100, Math.round(raw.score)),
      };
    } catch (parseErr) {
      logger.error(`Failed to parse scorer response for ${jobId}`, { parseErr });
      // Embedding-only fallback
      analysis = {
        score: embeddingScore,
        dimensions: { techStack: embeddingScore, seniorityFit: 60, domainFit: 70, compensationFit: 50, companyTier: 50 },
        verdict: embeddingScore >= 75 ? 'Good Match' : embeddingScore >= 55 ? 'Partial Match' : 'Weak Match',
        strengths: [],
        gaps: ['AI analysis unavailable — embedding-only score'],
        reasons: [`Embedding similarity: ${embeddingScore}/100`],
        whyApply: 'Manual review needed',
        whySkip: 'Insufficient data for full analysis',
        keywordsMatched: [],
        recommendation: 'Review manually',
        isTargetCompany,
        prescreenPassed: true,
      };
    }

    // Clamp to 0-100
    analysis.score = Math.max(0, Math.min(100, analysis.score));

    // ── Step 4: Persist ───────────────────────────────────────────────────
    await prisma.job.update({
      where: { id: jobId },
      data: {
        fitScore: analysis.score,
        fitAnalysis: analysis as unknown as import('@prisma/client').Prisma.InputJsonValue,
        status: 'SCORED',
        scoredAt: new Date(),
      },
    });

    logger.info(`Scored job ${jobId} (${job.title} @ ${job.company}): ${analysis.score}/100 [${analysis.verdict}]${isTargetCompany ? ' ⭐ DREAM COMPANY' : ''}`);
    return analysis;
  } catch (error) {
    logger.error(`Error scoring job ${jobId}`, { error });
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'SCORED', fitScore: -1 },
    }).catch(() => null);
    return null;
  }
}

// ─── Scoring Prompt ───────────────────────────────────────────────────────────

function buildScoringPrompt(
  jobTitle: string,
  company: string,
  jobDescription: string,
  salaryRaw: string | null | undefined,
  embeddingScore: number,
  calibration: string,
  isTargetCompany: boolean
): string {
  return `You are an expert technical recruiter scoring a candidate's fit for a job. Be precise and honest.

${CANDIDATE_PROFILE}

---

## Job Being Scored
- **Title:** ${jobTitle}
- **Company:** ${company}${isTargetCompany ? ' ⭐ (DREAM COMPANY — candidate is highly interested)' : ''}
- **Listed Salary:** ${salaryRaw || 'Not listed'}
- **Embedding Similarity (semantic):** ${embeddingScore}/100

## Job Description:
${jobDescription.slice(0, 5000)}

---

${calibration}

---

## SCORING INSTRUCTIONS

Score the candidate across 5 dimensions. Use CHAIN OF THOUGHT: reason through each dimension before scoring it.

### Dimension 1: Tech Stack Match (35% weight)
Think: What languages/frameworks does the JD require? Which does Rishav have at Strong/Comfortable/Familiar level?
- Strong: Java, C/C++, Spring Boot, WebSockets (STOMP), Socket.IO, PostgreSQL
- Comfortable: Node.js, React, Redis, Python, Django, Docker
- Score 90-100: JD tech is mostly Java/Spring Boot/Node/WebSocket/Redis (his exact stack)
- Score 70-89: JD is general backend/full-stack with overlapping tech
- Score 40-69: Partial overlap, but missing key required tech
- Score <40: JD requires tech he doesn't have (Python ML, iOS, Android, Go, Rust, etc.)

### Dimension 2: Seniority Fit (25% weight)
Think: Does the JD require experience he has as a fresh grad?
- Score 90-100: Explicitly "fresher" / "0-1 YOE" / "new grad" / "intern/PPO"
- Score 70-89: "1-2 YOE" — he's borderline but Samsung internship is real production work
- Score 40-69: "2-4 YOE required" — possible stretch, Samsung helps
- Score <40: "5+ YOE", "senior", "lead" required

### Dimension 3: Domain Fit (20% weight)
Think: Is this a Backend/SDE/Full-Stack role, or something else?
- Score 90-100: Core Backend / SDE / Distributed Systems / Full-Stack
- Score 60-89: Adjacent (DevOps with strong coding component, Platform Engineering)
- Score <40: Data Science, ML, Embedded, Mobile, QA, Frontend-only

### Dimension 4: Compensation Fit (10% weight)
Think: Does salary match Rishav's ₹15 LPA minimum?
- Score 90-100: Listed salary clearly ≥ ₹15 LPA or top-tier company (salary irrelevant)
- Score 60-89: Not listed but company tier suggests ≥ ₹15 LPA
- Score 40-59: Listed salary 10-15 LPA range
- Score <40: Listed salary < ₹10 LPA or clearly underpaid (stipend roles)

### Dimension 5: Company Tier (10% weight)
Think: Is this an engineering-first company or a body-shopper?
- Score 90-100: FAANG, top Indian funded startup (Razorpay, CRED, Zepto, Meesho, Swiggy, Zomato, Groww)
- Score 70-89: Mid-stage funded startup, good product company
- Score 50-69: Small startup, unknown company
- Score <30: Pure IT services, consulting, outsourcing

### Composite Score
Weighted average: (techStack*0.35 + seniority*0.25 + domain*0.20 + compensation*0.10 + companyTier*0.10)
IMPORTANT: Be calibrated — a score of 75+ means "apply immediately". Don't inflate scores for average matches.

---

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "score": <integer 0-100, weighted composite>,
  "dimensions": {
    "techStack": <integer 0-100>,
    "seniorityFit": <integer 0-100>,
    "domainFit": <integer 0-100>,
    "compensationFit": <integer 0-100>,
    "companyTier": <integer 0-100>
  },
  "verdict": "<Strong Match|Good Match|Partial Match|Weak Match>",
  "strengths": ["<specific strength from Rishav's profile matching this JD>", ...],
  "gaps": ["<specific gap: what JD requires that Rishav lacks>", ...],
  "reasons": ["<detailed reasoning bullet>", "<another>", ...],
  "whyApply": "<1-2 sentences: strongest concrete argument FOR applying>",
  "whySkip": "<1-2 sentences: biggest specific concern AGAINST applying, be honest>",
  "salaryEstimate": "<your estimate of CTC range, e.g. '18-25 LPA' or 'unknown'>",
  "keywordsMatched": ["<ATS keyword from JD present in Rishav's profile>", ...],
  "recommendation": "<one actionable sentence starting with Apply/Skip/Review>"
}`;
}

// ─── Profile Embedding ────────────────────────────────────────────────────────

export async function ensureProfileEmbedding(): Promise<void> {
  const profile = await prisma.userProfile.findFirst();
  if (!profile) return;

  if (profile.profileEmbedding.length > 0 && profile.embeddingComputedAt) {
    logger.info('Profile embedding already computed, skipping');
    return;
  }

  logger.info('Computing profile embedding from resume...');
  const profileText = buildProfileText(profile);
  const embedding = await generateEmbedding(profileText.slice(0, 8000));

  await prisma.userProfile.update({
    where: { id: profile.id },
    data: { profileEmbedding: embedding, embeddingComputedAt: new Date() },
  });

  logger.info(`✅ Profile embedding computed (${embedding.length} dimensions)`);
}

function buildProfileText(profile: { baseResumeLatex: string }): string {
  return profile.baseResumeLatex
    .replace(/\\[a-zA-Z]+(\{[^}]*\}|\[[^\]]*\])*/g, ' ')
    .replace(/[{}\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
