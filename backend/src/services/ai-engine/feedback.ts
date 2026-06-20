import { redis } from '../../core/redis';
import { logger } from '../../core/logger';

/**
 * Feedback Learning System
 *
 * When you approve or skip a job, we record an enriched signal to Redis.
 * The scorer reads the last 10 signals and includes them in its prompt as
 * calibration examples — making the agent genuinely learn your taste over time.
 *
 * Keys:
 *   feedback:approved → Redis list of JSON strings (capped at 20)
 *   feedback:skipped  → Redis list of JSON strings (capped at 20)
 */

export interface FeedbackSignal {
  title: string;
  company: string;
  companyTier?: string;
  score: number;
  dimensions?: {
    techStack: number;
    seniorityFit: number;
    domainFit: number;
    compensationFit: number;
    companyTier: number;
  };
  topStrengths: string[];           // top 2 strengths
  topGaps: string[];                // top 2 gaps
  whySkip?: string;                 // detailed skip explanation
  userComment?: string;             // manual notes
  timestamp: number;
}

const APPROVED_KEY = 'feedback:approved';
const SKIPPED_KEY = 'feedback:skipped';
const MAX_SIGNALS = 20;

/**
 * Record an approval signal when the user approves a job.
 */
export async function recordApproval(
  title: string,
  company: string,
  score: number,
  dimensions: any,
  strengths: string[],
  userComment?: string
): Promise<void> {
  try {
    const signal: FeedbackSignal = {
      title,
      company,
      score,
      dimensions,
      topStrengths: (strengths || []).slice(0, 2),
      topGaps: [],
      userComment,
      timestamp: Date.now(),
    };
    await redis.lpush(APPROVED_KEY, JSON.stringify(signal));
    await redis.ltrim(APPROVED_KEY, 0, MAX_SIGNALS - 1);
    logger.info(`Feedback: recorded approval for "${title}" @ ${company}`);
  } catch (err) {
    logger.warn('Failed to record approval signal', { error: err });
  }
}

/**
 * Record a skip signal when the user explicitly skips a job.
 */
export async function recordSkip(
  title: string,
  company: string,
  score: number,
  dimensions: any,
  gaps: string[],
  whySkip?: string,
  userComment?: string
): Promise<void> {
  try {
    const signal: FeedbackSignal = {
      title,
      company,
      score,
      dimensions,
      topStrengths: [],
      topGaps: (gaps || []).slice(0, 2),
      whySkip,
      userComment,
      timestamp: Date.now(),
    };
    await redis.lpush(SKIPPED_KEY, JSON.stringify(signal));
    await redis.ltrim(SKIPPED_KEY, 0, MAX_SIGNALS - 1);
    logger.info(`Feedback: recorded skip for "${title}" @ ${company}`);
  } catch (err) {
    logger.warn('Failed to record skip signal', { error: err });
  }
}

/**
 * Get formatted calibration text to inject into the scoring prompt.
 * Returns empty string if not enough signals yet.
 */
export async function getFeedbackCalibration(): Promise<string> {
  try {
    const [approvedRaw, skippedRaw] = await Promise.all([
      redis.lrange(APPROVED_KEY, 0, 9),
      redis.lrange(SKIPPED_KEY, 0, 9),
    ]);

    if (approvedRaw.length === 0 && skippedRaw.length === 0) {
      return ''; // No signals yet
    }

    const approved = approvedRaw.map((s) => JSON.parse(s) as FeedbackSignal);
    const skipped = skippedRaw.map((s) => JSON.parse(s) as FeedbackSignal);

    let calibration = '## Calibration From Past Decisions\n';
    calibration += 'Use these to calibrate your scoring — match the user\'s demonstrated preferences:\n\n';

    if (approved.length > 0) {
      calibration += '### ✅ Jobs the user APPROVED (scored highly & chose to apply):\n';
      approved.forEach((s) => {
        const dimsStr = s.dimensions
          ? `tech: ${s.dimensions.techStack}, exp: ${s.dimensions.seniorityFit}, dom: ${s.dimensions.domainFit}, comp: ${s.dimensions.compensationFit}, tier: ${s.dimensions.companyTier}`
          : 'N/A';
        calibration += `- "${s.title}" @ ${s.company} (score: ${s.score}/100, dims: [${dimsStr}], strengths: [${s.topStrengths.join(', ')}]${s.userComment ? `, note: "${s.userComment}"` : ''})\n`;
      });
    }

    if (skipped.length > 0) {
      calibration += '\n### ❌ Jobs the user SKIPPED (rejected despite scoring):\n';
      skipped.forEach((s) => {
        const dimsStr = s.dimensions
          ? `tech: ${s.dimensions.techStack}, exp: ${s.dimensions.seniorityFit}, dom: ${s.dimensions.domainFit}, comp: ${s.dimensions.compensationFit}, tier: ${s.dimensions.companyTier}`
          : 'N/A';
        calibration += `- "${s.title}" @ ${s.company} (score: ${s.score}/100, why skipped: "${s.whySkip || s.topGaps.join(', ') || 'N/A'}", dims: [${dimsStr}]${s.userComment ? `, note: "${s.userComment}"` : ''})\n`;
      });
    }

    calibration += '\nPattern: Score similar jobs to approved ones higher. Score similar jobs to skipped ones lower.\n';
    return calibration;
  } catch (err) {
    logger.warn('Failed to get feedback calibration', { error: err });
    return '';
  }
}

