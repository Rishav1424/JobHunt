import { redis } from '../../core/redis';
import { logger } from '../../core/logger';

/**
 * Feedback Learning System
 *
 * When you approve or skip a job, we record a compressed signal to Redis.
 * The scorer reads the last 10 signals and includes them in its prompt as
 * calibration examples — making the agent genuinely learn your taste over time.
 *
 * Keys:
 *   feedback:approved → Redis list of JSON strings (capped at 20)
 *   feedback:skipped  → Redis list of JSON strings (capped at 20)
 */

interface FeedbackSignal {
  title: string;
  company: string;
  score: number;
  techStack: string;    // comma-separated key techs from JD
  verdict: string;
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
  keywordsMatched: string[]
): Promise<void> {
  try {
    const signal: FeedbackSignal = {
      title, company, score,
      techStack: keywordsMatched.slice(0, 5).join(', '),
      verdict: 'Approved by user',
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
  gaps: string[]
): Promise<void> {
  try {
    const signal: FeedbackSignal = {
      title, company, score,
      techStack: gaps.slice(0, 3).join(', '),
      verdict: 'Skipped by user',
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
        calibration += `- "${s.title}" @ ${s.company} (score: ${s.score}/100, key techs: ${s.techStack || 'N/A'})\n`;
      });
    }

    if (skipped.length > 0) {
      calibration += '\n### ❌ Jobs the user SKIPPED (rejected despite scoring):\n';
      skipped.forEach((s) => {
        calibration += `- "${s.title}" @ ${s.company} (score: ${s.score}/100, concerns: ${s.techStack || 'N/A'})\n`;
      });
    }

    calibration += '\nPattern: Score similar jobs to approved ones higher. Score similar jobs to skipped ones lower.\n';
    return calibration;
  } catch (err) {
    logger.warn('Failed to get feedback calibration', { error: err });
    return '';
  }
}
