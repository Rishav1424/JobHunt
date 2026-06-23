import { flashModel, generateEmbedding, parseGeminiJSON, callWithRetry } from '../../core/gemini';
import { prisma } from '../../core/prisma';
import { logger } from '../../core/logger';
import { getCandidateRichContext } from './candidateContext';
import { getFeedbackCalibration } from './feedback';
import { getOrClassifyCompanyStatus } from './companyDirectory';
import { validateAndNormalizeWeights, extractJDSignal } from './scorer';
import { fetchJobDetails } from '../scrapers/detailFetcher';

export interface RefinedJobOutput {
  // Refined fields
  cleanTitle: string;
  cleanLocation: string;
  isRemote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryRaw: string | null;
  salaryType: 'CONFIRMED' | 'ESTIMATED' | 'UNKNOWN';
  cleanDescription: string;

  // Scoring results
  fitScore: number;
  verdict: string;
  dimensions: {
    techStack: number;
    seniorityFit: number;
    domainFit: number;
    compensationFit: number;
    companyTier: number;
  };
  strengths: string[];
  gaps: string[];
  reasons: string[];
  whyApply: string;
  whySkip: string;
  keywordsMatched: string[];
  recommendation: string;
  redFlags: string[];
  jdStructured: {
    requiredYoe: number | null;
    mustHaveSkills: string[];
    techStack: string[];
  };
}

// Pre-screening domain patterns (soft domain penalty)
const PRESCREEN_SKIP_TITLES = [
  /\bdata.?scientist\b/i, /\bdata.?analyst\b/i, /\bmachine.?learning\b/i,
  /\bml.?engineer\b/i, /\bai.?engineer\b/i, /\bdevops\b/i, /\bsre\b/i,
  /\bsite.?reliability\b/i, /\bqa.?engineer\b/i, /\bembedded\b/i,
  /\bfirmware\b/i, /\bmobile.?develop\b/i, /\bios.?develop\b/i,
  /\bandroid.?develop\b/i, /\bflutter\b/i, /\breact.?native\b/i,
  /\bmarketing\b/i, /\bsales\b/i, /\bproduct.?manager\b/i,
  /\bsupport.?engineer\b/i, /\btest.?engineer\b/i,
];

function shouldSoftPenalizeDomain(title: string): boolean {
  return PRESCREEN_SKIP_TITLES.some((p) => p.test(title));
}

function isDreamCompany(company: string, dreamList: string[]): boolean {
  const lower = company.toLowerCase().trim();
  return dreamList.some((d) => lower.includes(d.toLowerCase().trim()));
}

function descriptionQualityScore(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 200) return 0;
  if (cleaned.length < 500) return 0.5;
  const hasTechTerms = /\b(api|backend|java|python|node|spring|react|database|system|microservice|engineer|develop|software)\b/i.test(cleaned);
  return hasTechTerms ? 1.0 : 0.7;
}

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
    const maxPay = parseInt(rangePayMatch[2], 10);
    if (maxPay < minSalaryCutoff) {
      return { knockedOut: true, reason: `Salary range max is below threshold: ${rangePayMatch[0]} (min threshold: ${minSalaryCutoff} LPA)` };
    }
  } else {
    const singlePayMatch = combinedText.match(/\b(\d+)\s*(?:lpa|lacs|lakhs?|lakh)\b/i);
    if (singlePayMatch) {
      const singleSal = parseInt(singlePayMatch[1], 10);
      const matchIndex = singlePayMatch.index || 0;
      const matchLen = singlePayMatch[0].length;
      const surrounding = combinedText.substring(Math.max(0, matchIndex - 40), Math.min(combinedText.length, matchIndex + matchLen + 40));
      const isRangeText = /[\d]+\s*(?:-|to)\s*[\d]+/i.test(surrounding);

      if (!isRangeText && singleSal < minSalaryCutoff) {
        return { knockedOut: true, reason: `Salary matches low compensation heuristic: ${singlePayMatch[0]} (min threshold: ${minSalaryCutoff} LPA)` };
      }
    }
  }

  // 2. Seniority Penalty
  const isSeniorTitle = /\b(senior|sr\b|lead|principal|architect|manager|staff)\b/i.test(title) && !/\b(intern|co-op|fresher|graduate)\b/i.test(title);
  let yoeRequired = 0;
  const rangeMatch = combinedText.match(/\b(\d+)\s*(?:-|to)\s*(\d+)\+?\s*(?:yoe|years|yrs|years\s+of\s+experience)\b/i);
  
  if (rangeMatch) {
    yoeRequired = parseInt(rangeMatch[1], 10);
  } else {
    const yoeMatch = combinedText.match(/\b([1-9]|\d{2})\+?\s*(?:yoe|years|yrs|years\s+of\s+experience)\b/i);
    if (yoeMatch) {
      const matchIndex = yoeMatch.index || 0;
      const preceding = combinedText.substring(Math.max(0, matchIndex - 60), matchIndex);
      const hasSignal = /\b(minimum|require|at least|must have|experience of|exp|yoe)\b/i.test(preceding) || combinedText.includes('requirements');
      if (hasSignal) {
        yoeRequired = parseInt(yoeMatch[1], 10);
      }
    }
  }

  if (isSeniorTitle || yoeRequired >= minYoeCutoff) {
    return { knockedOut: false, seniorityPenalty: 15 };
  }

  return { knockedOut: false };
}

/**
 * Single-pass: refines the job listing and computes fit scores in a single Gemini call.
 */
export async function refineAndScoreJob(rawJob: {
  title: string;
  company: string;
  location?: string;
  isRemote?: boolean;
  description: string;
  url: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryRaw?: string;
  source: string;
}): Promise<RefinedJobOutput | null> {
  try {
    let description = rawJob.description || '';
    
    // 1. Fetch full page detail if description is short
    if ((!description || description.length < 300) && rawJob.url) {
      logger.info(`jobRefiner: Description is thin (${description.length} chars). Fetching full detail page for ${rawJob.url}...`);
      try {
        const details = await fetchJobDetails(rawJob.url);
        if (details?.description && details.description.length > description.length) {
          description = details.description;
        }
      } catch (fetchErr) {
        logger.warn(`jobRefiner: Detail fetch failed for ${rawJob.url}`, { error: fetchErr });
      }
    }

    // 2. Pre-step quality assessment
    const quality = descriptionQualityScore(description);
    if (quality === 0) {
      logger.warn(`jobRefiner: Discarding job "${rawJob.title}" at ${rawJob.company} due to garbage description quality.`);
      return null;
    }

    const [settings, candidateProfileText, calibration] = await Promise.all([
      prisma.settings.findFirst(),
      getCandidateRichContext(),
      getFeedbackCalibration(),
    ]);

    if (!settings) {
      throw new Error('Settings not initialized');
    }

    const targetCompanies = settings.targetCompanies || [];
    const minYoeCutoff = settings.minYoeCutoff ?? 3;
    const minSalaryCutoff = settings.minSalaryCutoff ?? 15;
    const dimensionWeights = (settings.dimensionWeights as Record<string, number> | null) || {
      techStack: 0.15,
      seniorityFit: 0.30,
      domainFit: 0.10,
      compensationFit: 0.25,
      companyTier: 0.20,
    };

    const isTarget = isDreamCompany(rawJob.company, targetCompanies);
    const matchesBlocklist = shouldSoftPenalizeDomain(rawJob.title);

    // 3. Hard knockout check
    const knockout = checkKnockout(rawJob.title, description, minYoeCutoff, minSalaryCutoff);
    if (knockout.knockedOut) {
      logger.info(`jobRefiner: Deterministic knockout triggered for "${rawJob.title}" @ ${rawJob.company}. Reason: ${knockout.reason}`);
      return {
        cleanTitle: rawJob.title,
        cleanLocation: rawJob.location || 'India',
        isRemote: rawJob.isRemote || false,
        salaryMin: rawJob.salaryMin || null,
        salaryMax: rawJob.salaryMax || null,
        salaryRaw: rawJob.salaryRaw || null,
        salaryType: 'UNKNOWN',
        cleanDescription: description.slice(0, 1000),
        fitScore: 0,
        verdict: 'Weak Match',
        dimensions: { techStack: 0, seniorityFit: 0, domainFit: 0, compensationFit: 0, companyTier: 0 },
        strengths: [],
        gaps: [knockout.reason || 'Requirement mismatch'],
        reasons: [`Knocked out: ${knockout.reason}`],
        whyApply: 'Not applicable — requirement mismatch',
        whySkip: knockout.reason || 'Requirement mismatch',
        keywordsMatched: [],
        recommendation: 'Skip — requirement mismatch',
        redFlags: [],
        jdStructured: { requiredYoe: null, mustHaveSkills: [], techStack: [] }
      };
    }

    const mncList = settings.mncCompanies || [];
    const startupList = settings.tier1Startups || [];
    const serviceList = settings.serviceCompanies || [];
    const companyStatus = await getOrClassifyCompanyStatus(rawJob.company, mncList, startupList, serviceList);

    const jdSignal = extractJDSignal(description);

    // 4. Single Gemini prompt structure for refinement + scoring
    const prompt = `You are an expert recruiter and software engineering auditor.
Your job is to perform a two-part analysis on the raw job listing below.

Part 1: Data Refinement
- Clean the job title (remove Urgency, Location names, YOE requirements, e.g., "Urgent SDE-II (Bangalore)" -> "SDE-II").
- Clean the location (normalize city names in India, check if remote).
- Extract salary values (min/max in INR LPA). Estimate if missing based on company tier.
- Summarize the clean description.

Part 2: Fit Scoring (based on Rishav's profile)
Evaluate Rishav's profile against this cleaned job context:
1. Tech Stack Fit (weight: ${dimensionWeights.techStack * 100}%)
2. Seniority Fit (weight: ${dimensionWeights.seniorityFit * 100}%)
3. Domain Fit (weight: ${dimensionWeights.domainFit * 100}%)
4. Compensation Fit (weight: ${dimensionWeights.compensationFit * 100}%)
5. Company Tier (weight: ${dimensionWeights.companyTier * 100}%)

Default weights:
* Seniority: ${dimensionWeights.seniorityFit}
* Compensation: ${dimensionWeights.compensationFit}
* Company Tier: ${dimensionWeights.companyTier}
* Tech Stack: ${dimensionWeights.techStack}
* Domain: ${dimensionWeights.domainFit}

Candidate Profile Context:
${candidateProfileText}

---

Feedback Calibration (past decisions):
${calibration}

---

Raw Job Details:
- Title: ${rawJob.title}
- Company: ${rawJob.company}
- Location: ${rawJob.location || 'India'}
- Is Remote: ${rawJob.isRemote}
- Salary Raw: ${rawJob.salaryRaw || 'Not listed'}
- Company Status: ${companyStatus}
- Dream Company: ${isTarget ? 'Yes' : 'No'}
- Description Snippet:
${jdSignal}

Instructions:
Evaluate the job listing carefully. Respond with ONLY a valid JSON object matching this schema:
{
  "cleanTitle": "<cleaned title string>",
  "cleanLocation": "<cleaned location string>",
  "isRemote": <boolean>,
  "salaryMin": <number or null, in LPA>,
  "salaryMax": <number or null, in LPA>,
  "salaryRaw": "<extracted salary text, or null>",
  "salaryType": "<CONFIRMED|ESTIMATED|UNKNOWN>",
  "cleanDescription": "<concise 2-3 paragraph summary of the job description>",
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
  "redFlags": ["<cultural/burnout red flag text>", ...],
  "strengths": ["<matching strength 1>", ...],
  "gaps": ["<specific missing requirement>", ...],
  "reasons": ["<reason bullet>", ...],
  "whyApply": "<1-2 sentence concrete reasoning>",
  "whySkip": "<1-2 sentence concern>",
  "keywordsMatched": ["<ATS keyword>", ...],
  "recommendation": "<Apply/Skip/Review sentence>",
  "jdStructured": {
    "requiredYoe": <number or null>,
    "mustHaveSkills": ["<skill>", ...],
    "techStack": ["<tech>", ...]
  }
}
`;

    const apiResult = await callWithRetry(
      () => flashModel.generateContent(prompt),
      4,
      `refineAndScoreJob:${rawJob.company}`
    );

    const rawResult = parseGeminiJSON<any>(apiResult.response.text());
    if (!rawResult) {
      return null;
    }

    // Apply blocklist domain penalization
    if (matchesBlocklist && !isTarget) {
      rawResult.dimensions.domainFit = Math.min(rawResult.dimensions.domainFit, 20);
    }

    // Apply seniority penalty if detected
    if (knockout.seniorityPenalty !== undefined) {
      rawResult.dimensions.seniorityFit = Math.min(rawResult.dimensions.seniorityFit, knockout.seniorityPenalty);
    }

    // Normalization and capping
    const weights = validateAndNormalizeWeights(rawResult.adjustedWeights, dimensionWeights);
    const sum = (weights.techStack || 0) + (weights.seniorityFit || 0) + (weights.domainFit || 0) + (weights.compensationFit || 0) + (weights.companyTier || 0);
    const scale = sum > 0 ? 1 / sum : 1;

    let finalScore = Math.round(
      ((rawResult.dimensions.techStack * (weights.techStack || 0.15) +
        rawResult.dimensions.seniorityFit * (weights.seniorityFit || 0.30) +
        rawResult.dimensions.domainFit * (weights.domainFit || 0.10) +
        rawResult.dimensions.compensationFit * (weights.compensationFit || 0.25) +
        rawResult.dimensions.companyTier * (weights.companyTier || 0.20)) * scale)
    );

    if (isTarget && !(rawResult.redFlags && rawResult.redFlags.length > 0)) {
      finalScore = Math.min(100, finalScore + 10);
    }

    if (rawResult.redFlags && rawResult.redFlags.length > 0) {
      finalScore = Math.min(60, finalScore);
    }

    return {
      ...rawResult,
      fitScore: Math.max(0, Math.min(100, finalScore)),
    } as RefinedJobOutput;
  } catch (error) {
    logger.error('Error in refineAndScoreJob', { error });
    return null;
  }
}
