import { flashModel, generateEmbedding, parseGeminiJSON, cosineSimilarity, callWithRetry } from '../../core/gemini';
import { prisma } from '../../core/prisma';
import { logger } from '../../core/logger';
import { getFeedbackCalibration } from './feedback';
import { getOrClassifyCompanyStatus, CompanyStatus } from './companyDirectory';

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
  redFlags?: string[];            // Warning signs/culture red flags
  domainRelevance?: string;        // Reasoning about domain relevance
  adjustedWeights?: Record<string, number>; // Dynamic weight distribution
}

// ─── Pre-screening ─────────────────────────────────────────────────────────────
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

function isDreamCompany(company: string, dreamList: string[]): boolean {
  const lower = company.toLowerCase().trim();
  return dreamList.some((d) => lower.includes(d.toLowerCase().trim()));
}

/**
 * Fast, regex-based deterministic knockout check.
 * Skips the LLM if the job requires YOE >= minYoeCutoff or pays low salary (< minSalaryCutoff).
 */
function checkKnockout(
  title: string,
  description: string,
  minYoeCutoff: number,
  minSalaryCutoff: number
): { knockedOut: boolean; reason: string } | null {
  const combinedText = `${title}\n\n${description}`.toLowerCase();

  // 1. Seniority Knockout
  const isSeniorTitle = /\b(senior|sr\b|lead|principal|architect|manager|staff)\b/i.test(title) && !/\b(intern|co-op|fresher|graduate)\b/i.test(title);
  
  let yoeRequired = 0;
  const rangeMatch = combinedText.match(/\b(\d+)\s*(?:-|to)\s*(\d+)\+?\s*(?:yoe|years|yrs|years\s+of\s+experience)\b/i);
  
  if (rangeMatch) {
    // Range present, like "0-3 years" -> minimum required is the start value.
    yoeRequired = parseInt(rangeMatch[1]);
  } else {
    const yoeMatch = combinedText.match(/\b([1-9]|\d{2})\+?\s*(?:yoe|years|yrs|years\s+of\s+experience)\b/i);
    if (yoeMatch) {
      yoeRequired = parseInt(yoeMatch[1]);
    }
  }

  if (isSeniorTitle) {
    return { knockedOut: true, reason: `Senior title detected: "${title}"` };
  }
  if (yoeRequired >= minYoeCutoff) {
    return { knockedOut: true, reason: `Experience requirement is too high: ${yoeRequired}+ YOE (matched YOE required >= ${minYoeCutoff})` };
  }

  // 2. Low Compensation Knockout (salary in LPA)
  const rangePayMatch = combinedText.match(/\b(\d+)\s*(?:-|to)\s*(\d+)\s*(?:lpa|lacs|lakhs?|lakh)\b/i);
  if (rangePayMatch) {
    const maxPay = parseInt(rangePayMatch[2]);
    if (maxPay < minSalaryCutoff) {
      return { knockedOut: true, reason: `Salary range max is below threshold: ${rangePayMatch[0]} (min threshold: ${minSalaryCutoff} LPA)` };
    }
  } else {
    // Single number matching, but guard against matching the start of a range e.g. "6 LPA - 20 LPA"
    const singlePayMatch = combinedText.match(/\b(\d+)\s*(?:lpa|lacs|lakhs?|lakh)\b/i);
    if (singlePayMatch) {
      const singleSal = parseInt(singlePayMatch[1]);
      
      const matchIndex = singlePayMatch.index || 0;
      const matchLen = singlePayMatch[0].length;
      const surrounding = combinedText.substring(Math.max(0, matchIndex - 10), Math.min(combinedText.length, matchIndex + matchLen + 10));
      const isRangeText = /[\d]+\s*(?:-|to)\s*[\d]+/i.test(surrounding);

      if (!isRangeText && singleSal < minSalaryCutoff) {
        return { knockedOut: true, reason: `Salary matches low compensation heuristic: ${singlePayMatch[0]} (min threshold: ${minSalaryCutoff} LPA)` };
      }
    }
  }

  return null;
}

// ─── Main Scoring Function ────────────────────────────────────────────────────

export async function scoreJob(jobId: string): Promise<FitAnalysis | null> {
  try {
    const [job, settings, profile] = await Promise.all([
      prisma.job.findUnique({ where: { id: jobId } }),
      prisma.settings.findFirst(),
      prisma.userProfile.findFirst(),
    ]);

    if (!job) return null;

    // Use default configurations if settings/profile tables aren't initialized
    const targetCompanies = settings?.targetCompanies || [];
    const minYoeCutoff = settings?.minYoeCutoff ?? 3;
    const minSalaryCutoff = settings?.minSalaryCutoff ?? 15;
    const dimensionWeights = (settings?.dimensionWeights as Record<string, number> | null) || {
      techStack: 0.15,
      seniorityFit: 0.30,
      domainFit: 0.10,
      compensationFit: 0.25,
      companyTier: 0.20,
    };

    const isTargetCompany = isDreamCompany(job.company, targetCompanies);

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

    // ── Deterministic Heuristic Knockouts ────────────────────────────────
    const knockout = checkKnockout(job.title, job.description, minYoeCutoff, minSalaryCutoff);
    if (knockout) {
      logger.info(`Deterministic Knockout triggered for "${job.title}" @ ${job.company}: ${knockout.reason}`);
      const zeroAnalysis: FitAnalysis = {
        score: 0,
        dimensions: { techStack: 0, seniorityFit: 0, domainFit: 0, compensationFit: 0, companyTier: 0 },
        verdict: 'Weak Match',
        strengths: [],
        gaps: [knockout.reason],
        reasons: [`Knocked out: ${knockout.reason}`],
        whyApply: 'Not applicable — requirement mismatch',
        whySkip: knockout.reason,
        keywordsMatched: [],
        recommendation: 'Skip — requirement mismatch',
        isTargetCompany,
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

    // ── Step 3: Company Status & Cache Enrichment ─────────────────────────
    const mncList = settings?.mncCompanies || [];
    const startupList = settings?.tier1Startups || [];
    const serviceList = settings?.serviceCompanies || [];
    const companyStatus = await getOrClassifyCompanyStatus(job.company, mncList, startupList, serviceList);

    // ── Step 4: Dynamic Candidate Profile Formatting ──────────────────────
    let candidateProfileText = '';
    if (profile) {
      const strippedResume = buildProfileText(profile);
      candidateProfileText = `
## Candidate: ${profile.name} (Location: ${profile.location})
- **Email:** ${profile.email}
- **Phone:** ${profile.phone}
- **LinkedIn:** ${profile.linkedinUrl || 'N/A'}
- **GitHub:** ${profile.githubUrl || 'N/A'}

### Technical Skills
${profile.skills.join(', ')}

### Resume Context & Details
${strippedResume}
`.trim();
    } else {
      // Fallback if profile not seeded
      candidateProfileText = `Candidate: Rishav Sharma. B.Tech NIT Durgapur. Skills: Java, C++, Spring Boot, Node.js, WebSockets, Postgres, Redis.`;
    }

    // ── Step 5: Gemini multi-dimensional analysis ─────────────────────────
    const prompt = buildScoringPrompt(
      job.title,
      job.company,
      job.description,
      job.salaryRaw,
      embeddingScore,
      calibration,
      isTargetCompany,
      companyStatus,
      candidateProfileText,
      dimensionWeights,
      minYoeCutoff,
      minSalaryCutoff
    );

    const result = await callWithRetry(
      () => flashModel.generateContent(prompt),
      4,
      `scoreJob:${job.title}@${job.company}`
    );

    let analysis: FitAnalysis;
    try {
      const raw = parseGeminiJSON<Omit<FitAnalysis, 'prescreenPassed' | 'isTargetCompany'>>(result.response.text());
      
      // Calculate composite score programmatically to enforce accuracy
      const weights = raw.adjustedWeights || dimensionWeights;

      const sum = (weights.techStack || 0) + (weights.seniorityFit || 0) + (weights.domainFit || 0) + (weights.compensationFit || 0) + (weights.companyTier || 0);
      const scale = sum > 0 ? 1 / sum : 1;

      let finalScore = Math.round(
        ((raw.dimensions.techStack * (weights.techStack || 0.15) +
          raw.dimensions.seniorityFit * (weights.seniorityFit || 0.30) +
          raw.dimensions.domainFit * (weights.domainFit || 0.10) +
          raw.dimensions.compensationFit * (weights.compensationFit || 0.25) +
          raw.dimensions.companyTier * (weights.companyTier || 0.20)) * scale)
      );

      // If red flags exist, cap final score at 60
      if (raw.redFlags && raw.redFlags.length > 0) {
        finalScore = Math.min(60, finalScore);
      }

      // If it's a dream company, give a floor boost of +10
      if (isTargetCompany) {
        finalScore = Math.min(100, finalScore + 10);
      }

      analysis = {
        ...raw,
        prescreenPassed: true,
        isTargetCompany,
        score: Math.max(0, Math.min(100, finalScore)),
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

    // ── Step 6: Persist ───────────────────────────────────────────────────
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
  isTargetCompany: boolean,
  companyStatus: string,
  candidateProfileText: string,
  weights: Record<string, number>,
  minYoeCutoff: number,
  minSalaryCutoff: number
): string {
  let companyStatusFlag = '';
  if (companyStatus === 'MNC') {
    companyStatusFlag = '\n- **Company Status:** Known Global MNC (Prestige Tier-1 Company)';
  } else if (companyStatus === 'TIER_1_STARTUP') {
    companyStatusFlag = '\n- **Company Status:** Known Tier-1 Indian Startup (High Growth, Well Funded)';
  } else if (companyStatus === 'SERVICE') {
    companyStatusFlag = '\n- **Company Status:** Service-Based Company (Infosys, TCS, Wipro, etc. - automatic low score)';
  }

  return `You are an expert technical recruiter scoring a candidate's fit for a job. Be precise and honest.

${candidateProfileText}

---

## Job Being Scored
- **Title:** ${jobTitle}
- **Company:** ${company}${isTargetCompany ? ' ⭐ (DREAM COMPANY — candidate is highly interested)' : ''}${companyStatusFlag}
- **Listed Salary:** ${salaryRaw || 'Not listed'}
- **Embedding Similarity (semantic):** ${embeddingScore}/100

## Job Description:
${jobDescription.slice(0, 5000)}

---

${calibration}

---

## SCORING INSTRUCTIONS

Before determining the scores, evaluate the domain relevance and the tech stack requirements. Use a Chain of Thought to complete a pre-scoring step:

1. **Pre-scoring Reasoning & Weights Adjustment**:
   - Provide a "domainRelevance" assessment (e.g. "High - aligns with real-time distributed systems").
   - You can dynamically adjust the weights using "adjustedWeights".
   - The default weights are:
     * **Seniority Fit**: ${weights.seniorityFit * 100}% (${weights.seniorityFit})
     * **Compensation Fit**: ${weights.compensationFit * 100}% (${weights.compensationFit})
     * **Company Tier**: ${weights.companyTier * 100}% (${weights.companyTier})
     * **Tech Stack Match**: ${weights.techStack * 100}% (${weights.techStack})
     * **Domain Fit**: ${weights.domainFit * 100}% (${weights.domainFit})
   - If a role requires a technology (like Go or Rust) that Rishav is only familiar with, but is building low-latency communication networks or distributed systems where his protocol-level/real-time experience is highly valuable, adjust "adjustedWeights" to put LESS weight on "techStack" and MORE weight on "experienceFit" and "domainFit".

2. **Dimension 1: Tech Stack Match (weight: ${weights.techStack * 100}%)**
   - Think: What languages/frameworks does the JD require? Which does Rishav have at Strong/Comfortable/Familiar level?
   - Score 90-100: JD tech is mostly Java/Spring Boot/Node/WebSocket/Redis (his exact stack).
   - Score 70-89: JD is general backend/full-stack with overlapping tech (e.g. JS/TS, Python).
   - Score <40: JD requires tech he doesn't have (Python ML, iOS, Android, etc.).

3. **Dimension 2: Seniority Fit (weight: ${weights.seniorityFit * 100}%)**
   - **CRITICAL EXPERIENCE FIT CALIBRATION**: Rishav is graduating in June 2026 and currently holds an intern role handling high-impact distributed systems (PTP, WebSockets).
   - Treat "0-1 YOE" or "Fresher/New Grad" or "Intern/PPO" as a **100 score**.
   - Roles requiring "1-2 YOE" can receive a score of **80-95** (as his Samsung internship is real production work).
   - Roles requiring **${minYoeCutoff}+ years of full-time experience** must receive a score **below 40**.

4. **Dimension 3: Domain Fit (weight: ${weights.domainFit * 100}%)**
   - Think: Is this a Backend/SDE/Full-Stack role, or something else?
   - Score 90-100: Core Backend / SDE / Distributed Systems / Full-Stack.
   - Score <40: Data Science, ML, Embedded, Mobile, QA, Frontend-only.

5. **Dimension 4: Compensation Fit (weight: ${weights.compensationFit * 100}%)**
   - Think: Does salary match Rishav's minimum threshold of ${minSalaryCutoff} LPA?
   - **SALARY INFERENCE CALIBRATION**:
     * If the salary is hidden, analyze the company tier. Top MNCs and funded unicorns generally offer ${minSalaryCutoff} LPA+ for entry-level SDEs. In these cases, score this dimension **85-100**.
     * Service-based companies typically offer ₹3-7 LPA. In these cases, score this dimension **below 40**.
   - Score 90-100: Listed salary clearly >= ${minSalaryCutoff} LPA.
   - Score 40-59: Listed salary 10-${minSalaryCutoff - 1} LPA range.
   - Score <40: Listed salary < 10 LPA.

6. **Dimension 5: Company Tier (weight: ${weights.companyTier * 100}%)**
   - Think: Is this an engineering-first company or a body-shopper?
   - Score 90-100: FAANG, top global MNCs, or top Indian funded startups (Razorpay, CRED, Zepto, Meesho, Zomato, Swiggy).
   - Score 70-89: Mid-stage funded startup, good product company.
   - Score <30: Pure IT services, consulting, outsourcing (TCS, Infosys, Wipro, Capgemini, Accenture, Cognizant, etc.).

7. **Cultural Red Flags**:
   - Scan the job description for warning signs ("redFlags") that contradict Rishav's goals (e.g. "fast-paced environment with tight deadlines" - code for burnout, "maintain legacy systems", or strict in-office mandates).
   - If a red flag is found, list it. The score will be capped at 60.

---

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "domainRelevance": "<reasoning about how closely the domain matches Rishav's background>",
  "adjustedWeights": {
    "techStack": <float 0.0-1.0>,
    "seniorityFit": <float 0.0-1.0>,
    "domainFit": <float 0.0-1.0>,
    "compensationFit": <float 0.0-1.0>,
    "companyTier": <float 0.0-1.0>
  },
  "score": <integer 0-100, weighted composite>,
  "dimensions": {
    "techStack": <integer 0-100>,
    "seniorityFit": <integer 0-100>,
    "domainFit": <integer 0-100>,
    "compensationFit": <integer 0-100>,
    "companyTier": <integer 0-100>
  },
  "verdict": "<Strong Match|Good Match|Partial Match|Weak Match>",
  "redFlags": ["<warning signs detected in JD>", ...],
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
