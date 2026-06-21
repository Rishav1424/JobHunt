import { flashModel, generateEmbedding, parseGeminiJSON, cosineSimilarity, callWithRetry } from '../../core/gemini';
import { prisma } from '../../core/prisma';
import { logger } from '../../core/logger';
import { getFeedbackCalibration, FeedbackSignal } from './feedback';
import { getOrClassifyCompanyStatus, CompanyStatus } from './companyDirectory';
import { redis } from '../../core/redis';

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
 * Task 25: Derive a soft blocklist from skip signals in Redis.
 * Words appearing in 3+ skipped job titles are returned as soft-block terms.
 * Result is cached for 1 hour.
 */
export async function getDynamicBlockTerms(): Promise<string[]> {
  try {
    const cached = await redis.get('dynamic:block_terms');
    if (cached) return JSON.parse(cached);

    const skippedRaw = await redis.lrange('feedback:skipped', 0, 29);
    const skipped = skippedRaw.map((s) => JSON.parse(s) as FeedbackSignal);

    const wordFreq: Record<string, number> = {};
    skipped.forEach((s) => {
      s.title.toLowerCase().split(/\s+/).forEach((w) => {
        if (w.length > 4) wordFreq[w] = (wordFreq[w] || 0) + 1;
      });
    });

    const blockTerms = Object.entries(wordFreq)
      .filter(([_, count]) => count >= 3)
      .map(([term]) => term);

    await redis.set('dynamic:block_terms', JSON.stringify(blockTerms), 'EX', 3600);
    logger.debug(`Dynamic block terms derived: ${blockTerms.join(', ')}`);
    return blockTerms;
  } catch (err) {
    logger.warn('getDynamicBlockTerms failed', { error: err });
    return [];
  }
}

/**
 * Task 26: Detect systematic score drift and persist a warning in Redis.
 * Called when there are enough feedback signals to identify if the scoring
 * model is consistently conservative (user approves low-scored jobs).
 */
export async function checkScoreDrift(): Promise<void> {
  try {
    const [approvedRaw, skippedRaw] = await Promise.all([
      redis.lrange('feedback:approved', 0, 29),
      redis.lrange('feedback:skipped', 0, 29),
    ]);

    const approvedSignals = approvedRaw.map((s) => JSON.parse(s) as FeedbackSignal);
    const skippedSignals = skippedRaw.map((s) => JSON.parse(s) as FeedbackSignal);

    if (approvedSignals.length < 5) return; // Not enough data

    const approvedAvgScore = approvedSignals.reduce((a, s) => a + s.score, 0) / approvedSignals.length;
    const skippedAvgScore = skippedSignals.length > 0
      ? skippedSignals.reduce((a, s) => a + s.score, 0) / skippedSignals.length
      : 0;

    if (approvedAvgScore < 65) {
      const warning = {
        type: 'CONSERVATIVE',
        approvedAvg: approvedAvgScore,
        skippedAvg: skippedAvgScore,
        message: `Approving jobs scored ${approvedAvgScore.toFixed(0)} avg — consider lowering fitScoreThreshold or recalibrating weights`,
        timestamp: Date.now(),
      };
      await redis.set('scoring:drift_warning', JSON.stringify(warning), 'EX', 86400);
      logger.warn(`Score drift detected: approved avg ${approvedAvgScore.toFixed(0)}/100 (threshold: 65)`);
    } else {
      // Clear stale warnings if scoring is healthy
      await redis.del('scoring:drift_warning');
    }
  } catch (err) {
    logger.warn('checkScoreDrift failed', { error: err });
  }
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
): { knockedOut: boolean; reason?: string; seniorityPenalty?: number } {
  const combinedText = `${title}\n\n${description}`.toLowerCase();

  // 1. Low Compensation Knockout (salary in LPA)
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
      const surrounding = combinedText.substring(Math.max(0, matchIndex - 40), Math.min(combinedText.length, matchIndex + matchLen + 40));
      const isRangeText = /[\d]+\s*(?:-|to)\s*[\d]+/i.test(surrounding);

      if (!isRangeText && singleSal < minSalaryCutoff) {
        return { knockedOut: true, reason: `Salary matches low compensation heuristic: ${singlePayMatch[0]} (min threshold: ${minSalaryCutoff} LPA)` };
      }
    }
  }

  // 2. Seniority Penalty (soft knockout)
  const isSeniorTitle = /\b(senior|sr\b|lead|principal|architect|manager|staff)\b/i.test(title) && !/\b(intern|co-op|fresher|graduate)\b/i.test(title);
  
  let yoeRequired = 0;
  const rangeMatch = combinedText.match(/\b(\d+)\s*(?:-|to)\s*(\d+)\+?\s*(?:yoe|years|yrs|years\s+of\s+experience)\b/i);
  
  if (rangeMatch) {
    yoeRequired = parseInt(rangeMatch[1]);
  } else {
    const yoeMatch = combinedText.match(/\b([1-9]|\d{2})\+?\s*(?:yoe|years|yrs|years\s+of\s+experience)\b/i);
    if (yoeMatch) {
      const matchIndex = yoeMatch.index || 0;
      const preceding = combinedText.substring(Math.max(0, matchIndex - 60), matchIndex);
      const hasSignal = /\b(minimum|require|at least|must have|experience of|exp|yoe)\b/i.test(preceding) || combinedText.includes('requirements');
      if (hasSignal) {
        yoeRequired = parseInt(yoeMatch[1]);
      }
    }
  }

  if (isSeniorTitle || yoeRequired >= minYoeCutoff) {
    return { knockedOut: false, seniorityPenalty: 15 };
  }

  return { knockedOut: false };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Truncate and preprocess job description to extract the signal-dense sections,
 * removing benefits, perks, and EEO boilerplates.
 */
export function extractJDSignal(description: string): string {
  const boilerplateMarkers = /\b(about us|what we offer|benefits|perks|equal opportunity|eeo|about the company|work culture|life at)\b/i;
  const match = description.search(boilerplateMarkers);
  const trimmed = match > 500 ? description.slice(0, match) : description;
  return trimmed.slice(0, 2500);
}

/**
 * Format structured profileJson (if available) into a clean, token-efficient text format.
 */
export function formatProfileJsonToText(profile: any): string {
  const json = profile.profileJson;
  if (!json || typeof json !== 'object') {
    return '';
  }
  let text = `## Candidate Profile (Structured Summary)\n`;
  if (json.facts) {
    text += `### Basic Facts:\n`;
    Object.entries(json.facts).forEach(([k, v]) => {
      text += `- **${k}:** ${v}\n`;
    });
  }
  if (json.skills) {
    text += `### Technical Skills & Depth:\n`;
    if (Array.isArray(json.skills)) {
      json.skills.forEach((s: any) => {
        text += `- **${s.name}:** ${s.level} (${s.context || ''})\n`;
      });
    }
  }
  if (json.preferences) {
    text += `### Career & Domain Preferences:\n`;
    if (json.preferences.rolePreferences) {
      text += `- **Target Roles:** ${(json.preferences.rolePreferences.primary || []).join(', ')}\n`;
      text += `- **Avoid Roles:** ${(json.preferences.rolePreferences.avoid || []).join(', ')}\n`;
    }
    if (json.preferences.domainInterests) {
      text += `- **Domain Interests:** ${(json.preferences.domainInterests || []).join(', ')}\n`;
    }
    if (json.preferences.dealBreakers) {
      text += `- **Deal Breakers:** ${(json.preferences.dealBreakers || []).join(', ')}\n`;
    }
  }
  return text.trim();
}

/**
 * Validate and normalize dynamic weights returned by Gemini.
 * Ensures no single weight exceeds 50% (0.50) to prevent degenerate score collapses.
 */
export function validateAndNormalizeWeights(raw: Record<string, number> | undefined, defaults: Record<string, number>): Record<string, number> {
  if (!raw || typeof raw !== 'object') return defaults;
  const keys = Object.keys(defaults);
  
  // Reject if any key is missing or negative or not a number
  const valid = keys.every(k => typeof raw[k] === 'number' && raw[k] >= 0);
  if (!valid) return defaults;
  
  const sum = keys.reduce((acc, k) => acc + raw[k], 0);
  if (sum === 0) return defaults;
  
  // Normalize
  const normalized = Object.fromEntries(keys.map(k => [k, raw[k] / sum]));
  
  // Constrain: no single weight > 0.5 (prevents degenerate collapses)
  const capped = Object.fromEntries(keys.map(k => [k, Math.min(normalized[k], 0.5)]));
  const cappedSum = keys.reduce((acc, k) => acc + capped[k], 0);
  if (cappedSum === 0) return defaults;
  
  return Object.fromEntries(keys.map(k => [k, capped[k] / cappedSum]));
}

// ─── Main Scoring Function ────────────────────────────────────────────────────

/**
 * Legacy wrapper: score a single job by delegating to the batch scorer.
 */
export async function scoreJob(jobId: string): Promise<FitAnalysis | null> {
  const results = await scoreJobsBatch([jobId]);
  return results[0]?.analysis || null;
}

/**
 * Task 8: Score a raw job description text without any DB reads/writes.
 * Used by the simulate-score endpoint to avoid the ghost-record problem.
 */
export async function scoreJDText(
  title: string,
  company: string,
  description: string
): Promise<FitAnalysis | null> {
  try {
    const [settings, profile] = await Promise.all([
      prisma.settings.findFirst(),
      prisma.userProfile.findFirst(),
    ]);

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

    const calibration = await getFeedbackCalibration();
    const mncList = settings?.mncCompanies || [];
    const startupList = settings?.tier1Startups || [];
    const serviceList = settings?.serviceCompanies || [];

    let candidateProfileText = '';
    if (profile) {
      const structuredSummary = formatProfileJsonToText(profile);
      candidateProfileText = structuredSummary || buildProfileText(profile).slice(0, 3000);
    } else {
      candidateProfileText = `Candidate: Rishav Sharma. B.Tech NIT Durgapur. Skills: Java, C++, Spring Boot, Node.js, WebSockets, Postgres, Redis.`;
    }

    const isTargetCompany = isDreamCompany(company, targetCompanies);
    const matchesBlocklist = shouldPrescreen(title);
    const knockout = checkKnockout(title, description, minYoeCutoff, minSalaryCutoff);

    if (knockout.knockedOut) {
      return {
        score: 0,
        dimensions: { techStack: 0, seniorityFit: 0, domainFit: 0, compensationFit: 0, companyTier: 0 },
        verdict: 'Weak Match',
        strengths: [],
        gaps: [knockout.reason || 'Requirement mismatch'],
        reasons: [`Knocked out: ${knockout.reason}`],
        whyApply: 'Not applicable — requirement mismatch',
        whySkip: knockout.reason || 'Requirement mismatch',
        keywordsMatched: [],
        recommendation: 'Skip — requirement mismatch',
        isTargetCompany,
        prescreenPassed: false,
      };
    }

    const companyStatus = await getOrClassifyCompanyStatus(company, mncList, startupList, serviceList);

    const jobForGemini = {
      id: 'simulation',
      title,
      company,
      description: extractJDSignal(description),
      salaryRaw: null as string | null,
      embeddingScore: 50, // no profile embedding for simulation
      companyStatus,
      isTargetCompany,
      titleMatchesBlocklist: matchesBlocklist,
      seniorityPenalty: knockout.seniorityPenalty,
    };

    const prompt = buildBatchScoringPrompt(
      [jobForGemini],
      candidateProfileText,
      calibration,
      dimensionWeights,
      minYoeCutoff,
      minSalaryCutoff
    );

    const apiResult = await callWithRetry(
      () => flashModel.generateContent(prompt),
      4,
      'scoreJDText:simulation'
    );

    let parsedBatch: any[] = [];
    try {
      parsedBatch = parseGeminiJSON<any[]>(apiResult.response.text());
    } catch (parseErr) {
      logger.error('Failed to parse simulation scorer JSON response', { parseErr });
      return null;
    }

    const rawAnalysis = Array.isArray(parsedBatch) ? parsedBatch[0] : null;
    if (!rawAnalysis) return null;

    if (matchesBlocklist && !isTargetCompany) {
      rawAnalysis.dimensions.domainFit = Math.min(rawAnalysis.dimensions.domainFit, 20);
    }
    if (knockout.seniorityPenalty !== undefined) {
      rawAnalysis.dimensions.seniorityFit = Math.min(rawAnalysis.dimensions.seniorityFit, knockout.seniorityPenalty);
    }

    const weights = validateAndNormalizeWeights(rawAnalysis.adjustedWeights, dimensionWeights);
    const sum = (weights.techStack || 0) + (weights.seniorityFit || 0) + (weights.domainFit || 0) + (weights.compensationFit || 0) + (weights.companyTier || 0);
    const scale = sum > 0 ? 1 / sum : 1;

    let finalScore = Math.round(
      ((rawAnalysis.dimensions.techStack * (weights.techStack || 0.15) +
        rawAnalysis.dimensions.seniorityFit * (weights.seniorityFit || 0.30) +
        rawAnalysis.dimensions.domainFit * (weights.domainFit || 0.10) +
        rawAnalysis.dimensions.compensationFit * (weights.compensationFit || 0.25) +
        rawAnalysis.dimensions.companyTier * (weights.companyTier || 0.20)) * scale)
    );

    if (isTargetCompany && !(rawAnalysis.redFlags?.length > 0)) {
      finalScore = Math.min(100, finalScore + 10);
    }
    if (rawAnalysis.redFlags?.length > 0) {
      finalScore = Math.min(60, finalScore);
    }

    return {
      ...rawAnalysis,
      prescreenPassed: true,
      isTargetCompany,
      score: Math.max(0, Math.min(100, finalScore)),
    } as FitAnalysis;
  } catch (err) {
    logger.error('scoreJDText failed', { error: err });
    return null;
  }
}

/**
 * Batch score up to 3 jobs in a single call to Gemini.
 */
export async function scoreJobsBatch(
  jobIds: string[]
): Promise<{ jobId: string; analysis: FitAnalysis | null }[]> {
  const results: { jobId: string; analysis: FitAnalysis | null }[] = [];

  try {
    const [settings, profile] = await Promise.all([
      prisma.settings.findFirst(),
      prisma.userProfile.findFirst(),
    ]);

    // Task 6: Auto-generate profileJson if missing to ensure quality scoring
    if (profile && !profile.profileJson) {
      logger.warn('profileJson is null — scoring quality may degrade. Auto-generating...');
      await ensureProfileJson(profile);
      // Refresh profile with newly generated json
      const refreshed = await prisma.userProfile.findFirst();
      if (refreshed) Object.assign(profile, refreshed);
    }

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

    const calibration = await getFeedbackCalibration();
    const mncList = settings?.mncCompanies || [];
    const startupList = settings?.tier1Startups || [];
    const serviceList = settings?.serviceCompanies || [];


    // Format Candidate Profile Text once for the batch
    let candidateProfileText = '';
    if (profile) {
      const structuredSummary = formatProfileJsonToText(profile);
      if (structuredSummary) {
        candidateProfileText = structuredSummary;
      } else {
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
${strippedResume.slice(0, 3000)}
`.trim();
      }
    } else {
      candidateProfileText = `Candidate: Rishav Sharma. B.Tech NIT Durgapur. Skills: Java, C++, Spring Boot, Node.js, WebSockets, Postgres, Redis.`;
    }

    const jobsForGemini: any[] = [];

    for (const jobId of jobIds) {
      const job = await prisma.job.findUnique({ where: { id: jobId } });
      if (!job) {
        results.push({ jobId, analysis: null });
        continue;
      }

      const isTargetCompany = isDreamCompany(job.company, targetCompanies);

      // Pre-screening blocklist (soft domain pre-screen)
      const matchesBlocklist = shouldPrescreen(job.title);

      // Deterministic knockout
      const knockout = checkKnockout(job.title, job.description, minYoeCutoff, minSalaryCutoff);

      if (knockout && knockout.knockedOut) {
        const reason = knockout.reason || 'Requirement mismatch';
        logger.info(`Deterministic Knockout triggered for "${job.title}" @ ${job.company}: ${reason}`);
        const zeroAnalysis: FitAnalysis = {
          score: 0,
          dimensions: { techStack: 0, seniorityFit: 0, domainFit: 0, compensationFit: 0, companyTier: 0 },
          verdict: 'Weak Match',
          strengths: [],
          gaps: [reason],
          reasons: [`Knocked out: ${reason}`],
          whyApply: 'Not applicable — requirement mismatch',
          whySkip: reason,
          keywordsMatched: [],
          recommendation: 'Skip — requirement mismatch',
          isTargetCompany,
          prescreenPassed: false,
        };
        await prisma.job.update({
          where: { id: jobId },
          data: { fitScore: 0, fitAnalysis: zeroAnalysis as any, status: 'SCORED', scoredAt: new Date() },
        });
        results.push({ jobId, analysis: zeroAnalysis });
        continue;
      }

      // Compute embedding similarity score, prioritizing section-specific cluster embeddings
      let embeddingScore = 50;
      let jobEmbedding = job.embedding;

      if (profile) {
        if (!jobEmbedding || jobEmbedding.length === 0) {
          const jdText = `${job.title} at ${job.company}\n\n${job.description}`;
          jobEmbedding = await generateEmbedding(jdText.slice(0, 8000));
          await prisma.job.update({ where: { id: jobId }, data: { embedding: jobEmbedding } });
        }

        const hasClusterEmbeddings =
          (profile.skillsEmbedding && profile.skillsEmbedding.length > 0) ||
          (profile.systemsEmbedding && profile.systemsEmbedding.length > 0) ||
          (profile.webEmbedding && profile.webEmbedding.length > 0) ||
          (profile.projectEmbedding && profile.projectEmbedding.length > 0);

        if (hasClusterEmbeddings) {
          const sims: number[] = [];
          if (profile.skillsEmbedding && profile.skillsEmbedding.length > 0) {
            sims.push(cosineSimilarity(profile.skillsEmbedding, jobEmbedding));
          }
          if (profile.systemsEmbedding && profile.systemsEmbedding.length > 0) {
            sims.push(cosineSimilarity(profile.systemsEmbedding, jobEmbedding));
          }
          if (profile.webEmbedding && profile.webEmbedding.length > 0) {
            sims.push(cosineSimilarity(profile.webEmbedding, jobEmbedding));
          }
          if (profile.projectEmbedding && profile.projectEmbedding.length > 0) {
            sims.push(cosineSimilarity(profile.projectEmbedding, jobEmbedding));
          }
          const maxSim = sims.length > 0 ? Math.max(...sims) : cosineSimilarity(profile.profileEmbedding, jobEmbedding);
          embeddingScore = Math.round(Math.max(0, Math.min(1, (maxSim - 0.2) / 0.7)) * 100);
        } else if (profile.profileEmbedding && profile.profileEmbedding.length > 0) {
          const rawSimilarity = cosineSimilarity(profile.profileEmbedding, jobEmbedding);
          embeddingScore = Math.round(Math.max(0, Math.min(1, (rawSimilarity - 0.2) / 0.7)) * 100);
        }
      }

      const companyStatus = await getOrClassifyCompanyStatus(job.company, mncList, startupList, serviceList);

      jobsForGemini.push({
        id: jobId,
        title: job.title,
        company: job.company,
        description: extractJDSignal(job.description),
        salaryRaw: job.salaryRaw,
        embeddingScore,
        companyStatus,
        isTargetCompany,
        titleMatchesBlocklist: matchesBlocklist,
        seniorityPenalty: knockout.seniorityPenalty,
      });
    }

    if (jobsForGemini.length === 0) {
      return results;
    }

    // Call Gemini with the batch scoring prompt
    const prompt = buildBatchScoringPrompt(
      jobsForGemini,
      candidateProfileText,
      calibration,
      dimensionWeights,
      minYoeCutoff,
      minSalaryCutoff,
      profile  // Task 29: pass profile for dynamic fresh-grad context
    );

    const apiResult = await callWithRetry(
      () => flashModel.generateContent(prompt),
      4,
      `scoreJobsBatch:${jobsForGemini.length} jobs`
    );

    let parsedBatch: any[] = [];
    try {
      parsedBatch = parseGeminiJSON<any[]>(apiResult.response.text());
    } catch (parseErr) {
      logger.error('Failed to parse batch scorer JSON response', { parseErr });
    }

    for (const jobData of jobsForGemini) {
      const jobId = jobData.id;
      const rawAnalysis = Array.isArray(parsedBatch) ? parsedBatch.find((item) => item.jobId === jobId) : null;

      let finalAnalysis: FitAnalysis;

      if (rawAnalysis) {
        // Enforce blocklist soft penalty programmatically
        if (jobData.titleMatchesBlocklist && !jobData.isTargetCompany) {
          rawAnalysis.dimensions.domainFit = Math.min(rawAnalysis.dimensions.domainFit, 20);
        }

        // Apply seniority penalty if detected
        if (jobData.seniorityPenalty !== undefined) {
          rawAnalysis.dimensions.seniorityFit = Math.min(rawAnalysis.dimensions.seniorityFit, jobData.seniorityPenalty);
        }

        // Enforce validated and normalized weights
        const weights = validateAndNormalizeWeights(rawAnalysis.adjustedWeights, dimensionWeights);

        const sum = (weights.techStack || 0) + (weights.seniorityFit || 0) + (weights.domainFit || 0) + (weights.compensationFit || 0) + (weights.companyTier || 0);
        const scale = sum > 0 ? 1 / sum : 1;

        let finalScore = Math.round(
          ((rawAnalysis.dimensions.techStack * (weights.techStack || 0.15) +
            rawAnalysis.dimensions.seniorityFit * (weights.seniorityFit || 0.30) +
            rawAnalysis.dimensions.domainFit * (weights.domainFit || 0.10) +
            rawAnalysis.dimensions.compensationFit * (weights.compensationFit || 0.25) +
            rawAnalysis.dimensions.companyTier * (weights.companyTier || 0.20)) * scale)
        );

        // If it's a dream company and no red flags, give a floor boost of +10
        if (jobData.isTargetCompany && !(rawAnalysis.redFlags && rawAnalysis.redFlags.length > 0)) {
          finalScore = Math.min(100, finalScore + 10);
        }

        // If red flags exist, cap final score at 60
        if (rawAnalysis.redFlags && rawAnalysis.redFlags.length > 0) {
          finalScore = Math.min(60, finalScore);
        }

        finalAnalysis = {
          ...rawAnalysis,
          prescreenPassed: true,
          isTargetCompany: jobData.isTargetCompany,
          score: Math.max(0, Math.min(100, finalScore)),
        };

        // Cache jdStructured if present
        if (rawAnalysis.jdStructured) {
          await prisma.job.update({
            where: { id: jobId },
            data: { jdStructured: rawAnalysis.jdStructured as any },
          });
        }
      } else {
        // Fallback for this job
        finalAnalysis = {
          score: jobData.embeddingScore,
          dimensions: { techStack: jobData.embeddingScore, seniorityFit: 60, domainFit: 70, compensationFit: 50, companyTier: 50 },
          verdict: jobData.embeddingScore >= 75 ? 'Good Match' : jobData.embeddingScore >= 55 ? 'Partial Match' : 'Weak Match',
          strengths: [],
          gaps: ['AI analysis unavailable — batch parsing fallback'],
          reasons: [`Embedding similarity: ${jobData.embeddingScore}/100`],
          whyApply: 'Manual review needed',
          whySkip: 'Insufficient data for full analysis',
          keywordsMatched: [],
          recommendation: 'Review manually',
          isTargetCompany: jobData.isTargetCompany,
          prescreenPassed: true,
        };
      }

      await prisma.job.update({
        where: { id: jobId },
        data: {
          fitScore: finalAnalysis.score,
          fitAnalysis: finalAnalysis as any,
          status: 'SCORED',
          scoredAt: new Date(),
        },
      });

      logger.info(`Scored job ${jobId} (${jobData.title} @ ${jobData.company}): ${finalAnalysis.score}/100 [${finalAnalysis.verdict}]`);

      // Task 17: Post-scoring semantic dedup — check for similar jobs from same company
      try {
        const scoredJob = await prisma.job.findUnique({ where: { id: jobId }, select: { embedding: true } });
        if (scoredJob?.embedding && scoredJob.embedding.length > 0) {
          const vectorStr = `[${scoredJob.embedding.join(',')}]`;
          const potentialDups = await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Job"
            WHERE company = ${jobData.company}
              AND id != ${jobId}
              AND status = 'SCORED'
              AND "scrapedAt" > NOW() - INTERVAL '7 days'
              AND 1 - (embedding_vec <=> cast(${vectorStr} as vector)) > 0.95
            LIMIT 1
          `;
          if (potentialDups.length > 0) {
            logger.info(`Job ${jobId} ("${jobData.title}") is likely a cross-source duplicate of ${potentialDups[0].id} — marking SKIPPED`);
            await prisma.job.update({ where: { id: jobId }, data: { status: 'SKIPPED', fitScore: -2 } });
          }
        }
      } catch (dupErr) {
        logger.debug('Semantic dedup check failed (non-fatal)', { error: dupErr });
      }

      results.push({ jobId, analysis: finalAnalysis });
    }
  } catch (err) {
    logger.error('Error in batch scoring jobs', { error: err });
    // Push errors
    for (const jobId of jobIds) {
      if (!results.some(r => r.jobId === jobId)) {
        results.push({ jobId, analysis: null });
      }
    }
  }

  return results;
}

// ─── Batch Scoring Prompt ────────────────────────────────────────────────────────

function buildBatchScoringPrompt(
  jobs: {
    id: string;
    title: string;
    company: string;
    description: string;
    salaryRaw: string | null | undefined;
    embeddingScore: number;
    companyStatus: string;
    isTargetCompany: boolean;
    titleMatchesBlocklist: boolean;
  }[],
  candidateProfileText: string,
  calibration: string,
  weights: Record<string, number>,
  minYoeCutoff: number,
  minSalaryCutoff: number,
  profile?: any
): string {
  let jobsText = '';
  jobs.forEach((job, idx) => {
    let companyStatusFlag = '';
    if (job.companyStatus === 'MNC') {
      companyStatusFlag = '\n- **Company Status:** Known Global MNC (Prestige Tier-1 Company)';
    } else if (job.companyStatus === 'TIER_1_STARTUP') {
      companyStatusFlag = '\n- **Company Status:** Known Tier-1 Indian Startup (High Growth, Well Funded)';
    } else if (job.companyStatus === 'SERVICE') {
      companyStatusFlag = '\n- **Company Status:** Service-Based Company (Infosys, TCS, Wipro, etc. - automatic low score)';
    }

    jobsText += `
---
## Job #${idx + 1}
- **Job ID:** ${job.id}
- **Title:** ${job.title}
- **Company:** ${job.company}${job.isTargetCompany ? ' ⭐ (DREAM COMPANY — candidate is highly interested)' : ''}${companyStatusFlag}
- **Listed Salary:** ${job.salaryRaw || 'Not listed'}
- **Embedding Similarity (semantic):** ${job.embeddingScore}/100
- **Matches Blocklist Heuristics:** ${job.titleMatchesBlocklist ? 'Yes (SRE/DevOps/QA/ML/DataScience soft-block matches - penalize Domain Fit unless heavy SDE content)' : 'No'}

### Job Description (Preprocessed):
${job.description}
`;
  });

  return `You are an expert technical recruiter scoring a candidate's fit for multiple jobs. Be precise and honest.

${candidateProfileText}

---

${calibration}

---

## Jobs to Score:
${jobsText}

---

## SCORING INSTRUCTIONS

For EACH job in the list, evaluate the candidate's fit based on:
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
   - **CRITICAL EXPERIENCE FIT CALIBRATION**:
${profile?.profileJson
  ? `   - ${profile.profileJson.facts?.name || 'The candidate'} is a final-year B.Tech student graduating ${profile.profileJson.facts?.graduationDate || 'June 2026'}. Current role: ${profile.profileJson.facts?.currentRole || 'Intern at Samsung R&D'}. This internship involves production-grade distributed systems work (PTP clock sync, audio codecs, FEC protocols, WebSockets at scale) — treat it as equivalent to 1 year of backend production experience.`
  : '   - Rishav is graduating in June 2026 and currently holds an intern role handling high-impact distributed systems (PTP, WebSockets).'}
   - Treat "0-1 YOE" or "Fresher/New Grad" or "Intern/PPO" as a **100 score**.
   - Roles requiring "1-2 YOE" can receive a score of **80-95** (as his Samsung internship is real production work).
   - Any role explicitly targeting "0-3 YOE" or "New Grad" or "Fresher" should score seniorityFit >= 85.
   - Roles requiring **${minYoeCutoff}+ years of full-time experience** must receive a score **below 40**.

4. **Dimension 3: Domain Fit (weight: ${weights.domainFit * 100}%)**
   - Think: Is this a Backend/SDE/Full-Stack role, or something else?
   - Score 90-100: Core Backend / SDE / Distributed Systems / Full-Stack.
   - Score <40: Data Science, ML, Embedded, Mobile, QA, Frontend-only.
   - If the job title matches blocklist heuristics, and description does not have heavy backend SDE coding, score this dimension below 30.

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

---

Respond with ONLY a valid JSON array of objects (no markdown, no extra text, just raw JSON). Do not wrap the JSON array in markdown formatting:
[
  {
    "jobId": "<ID of the job, exactly matching one of the Job IDs provided>",
    "domainRelevance": "<reasoning about how closely the domain matches Rishav's background>",
    "adjustedWeights": {
      "techStack": <float 0.0-1.0>,
      "seniorityFit": <float 0.0-1.0>,
      "domainFit": <float 0.0-1.0>,
      "compensationFit": <float 0.0-1.0>,
      "companyTier": <float 0.0-1.0>
    },
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
    "recommendation": "<one actionable sentence starting with Apply/Skip/Review>",
    "jdStructured": {
      "requiredYoe": <number or null>,
      "mustHaveSkills": ["<skill>", ...],
      "techStack": ["<tech>", ...]
    }
  },
  ...
]`;
}

// ─── Profile Embedding & Reseeding ────────────────────────────────────────────

/**
 * Task 6: Auto-generate structured profileJson from the base LaTeX resume if missing.
 * Called at the start of scoreJobsBatch() to ensure scoring always has rich structured data.
 */
export async function ensureProfileJson(profile: { id: string; profileJson: any; baseResumeLatex: string }): Promise<void> {
  if (profile.profileJson) return; // already exists
  if (!profile.baseResumeLatex || profile.baseResumeLatex.trim().startsWith('% Resume not found')) {
    logger.warn('ensureProfileJson: skipping — baseResumeLatex is empty or placeholder');
    return;
  }

  logger.info('profileJson is missing — auto-generating from LaTeX resume...');
  const prompt = `Parse this LaTeX resume and return ONLY a JSON object with these keys:
{
  "facts": { "name": string, "email": string, "phone": string, "location": string, "graduationDate": string, "college": string, "degree": string, "cgpa": string, "currentRole": string, "noticePeriod": string },
  "skills": [{ "name": string, "level": "strong|comfortable|familiar", "context": string }],
  "preferences": { "rolePreferences": { "primary": string[], "avoid": string[] }, "domainInterests": string[], "dealBreakers": string[] }
}

Resume:
${profile.baseResumeLatex.slice(0, 6000)}`;

  try {
    const result = await callWithRetry(() => flashModel.generateContent(prompt), 3, 'generateProfileJson');
    const profileJson = parseGeminiJSON<Record<string, unknown>>(result.response.text());
    await prisma.userProfile.update({
      where: { id: profile.id },
      data: { profileJson: profileJson as any },
    });
    logger.info('✅ profileJson auto-generated and saved from LaTeX resume');
  } catch (err) {
    logger.warn('Failed to auto-generate profileJson from resume', { error: err });
  }
}

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

  const vectorStr = `[${embedding.join(',')}]`;
  await prisma.$executeRawUnsafe(
    'UPDATE "UserProfile" SET profile_embedding_vec = cast($1 as vector) WHERE id = $2',
    vectorStr,
    profile.id
  );

  logger.info(`✅ Profile embedding computed (${embedding.length} dimensions)`);
}

export function buildProfileText(profile: { baseResumeLatex: string }): string {
  return profile.baseResumeLatex
    .replace(/\\[a-zA-Z]+(\{[^}]*\}|\[[^\]]*\])*/g, ' ')
    .replace(/[{}\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recomputes segment-specific cluster embeddings for technical skills, backend systems,
 * fullstack web, and project experience, caching them in the UserProfile.
 */
export async function recomputeClusterEmbeddings(profileId: string): Promise<void> {
  try {
    const profile = await prisma.userProfile.findUnique({ where: { id: profileId } });
    if (!profile) return;

    const latex = profile.baseResumeLatex;
    if (!latex || latex.trim().startsWith('% Resume not found')) {
      logger.warn('Skipping cluster embeddings recomputation: resume not found or empty.');
      return;
    }

    logger.info('🧠 Clustering profile experience into sections using Gemini...');
    const clusteringPrompt = `
You are an expert resume parser and AI recruiter. Group the candidate's experience and skills from the following LaTeX resume into four key distinct areas:
1. **skillsText**: A detailed list of all technical skills, languages, tools, frameworks, and core competencies.
2. **systemsText**: All experience, projects, or bullets related to backend infrastructure, distributed systems, real-time systems, networking, database engineering, STOMP/WebSockets, clock sync, STREAMS, multi-threading, performance optimizations, and backend architecture.
3. **webText**: All experience, projects, or bullets related to fullstack development, web applications, frontend frameworks (React, etc.), REST API design, user interfaces, and product-level web engineering.
4. **projectsText**: A comprehensive summary of all major personal and professional projects, detailing what was built, key achievements, metrics, and technologies used.

LaTeX Resume:
${latex}

Return a JSON object containing the fields: skillsText, systemsText, webText, and projectsText. Make each section a detailed description (approx 500-1000 characters each) to capture all rich context and keywords.
`;

    const response = await callWithRetry(async () => {
      const result = await flashModel.generateContent(clusteringPrompt);
      return result.response.text();
    }, 3, 'clusterProfileExperience');

    interface ClusteredProfile {
      skillsText: string;
      systemsText: string;
      webText: string;
      projectsText: string;
    }

    const clustered = parseGeminiJSON<ClusteredProfile>(response);
    logger.info('   Clustered successfully. Generating section embeddings...');

    const [skillsEmb, systemsEmb, webEmb, projectsEmb] = await Promise.all([
      generateEmbedding(clustered.skillsText || 'No skills experience.'),
      generateEmbedding(clustered.systemsText || 'No systems experience.'),
      generateEmbedding(clustered.webText || 'No web experience.'),
      generateEmbedding(clustered.projectsText || 'No projects experience.'),
    ]);

    await prisma.userProfile.update({
      where: { id: profileId },
      data: {
        skillsEmbedding: skillsEmb,
        systemsEmbedding: systemsEmb,
        webEmbedding: webEmb,
        projectEmbedding: projectsEmb,
      },
    });

    logger.info('✅ Cluster embeddings recomputed successfully!');
  } catch (err) {
    logger.error('Failed to recompute cluster embeddings', { error: err });
  }
}

