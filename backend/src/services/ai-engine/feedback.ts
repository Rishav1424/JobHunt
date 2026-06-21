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
const MAX_SIGNALS = 30;

// Task 10: Redis cache for calibration text (5-minute TTL)
const CALIBRATION_CACHE_KEY = 'feedback:calibration:text';
const CALIBRATION_CACHE_TTL = 300; // 5 minutes

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
    // Invalidate calibration cache so next scoring run picks up the new signal
    await redis.del(CALIBRATION_CACHE_KEY);
    logger.info(`Feedback: recorded approval for "${title}" @ ${company}`);

    // Trigger recalibration check
    const count = await redis.incr('feedback:total_count');
    if (count % 10 === 0) {
      const { triggerWeightRecalibration } = require('../../jobs/queues');
      await triggerWeightRecalibration().catch((err: any) =>
        logger.warn('Failed to trigger weight recalibration', { error: err })
      );
    }
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
    // Invalidate calibration cache so next scoring run picks up the new signal
    await redis.del(CALIBRATION_CACHE_KEY);
    logger.info(`Feedback: recorded skip for "${title}" @ ${company}`);

    // Trigger recalibration check
    const count = await redis.incr('feedback:total_count');
    if (count % 10 === 0) {
      const { triggerWeightRecalibration } = require('../../jobs/queues');
      await triggerWeightRecalibration().catch((err: any) =>
        logger.warn('Failed to trigger weight recalibration', { error: err })
      );
    }
  } catch (err) {
    logger.warn('Failed to record skip signal', { error: err });
  }
}

/**
 * Get formatted calibration text to inject into the scoring prompt.
 * Cached in Redis for 5 minutes to avoid 2 lrange calls per scoring run.
 * Returns empty string if not enough signals yet.
 */
export async function getFeedbackCalibration(): Promise<string> {
  try {
    // Task 10: Return cached calibration if available
    const cached = await redis.get(CALIBRATION_CACHE_KEY);
    if (cached) {
      logger.debug('Returning cached feedback calibration text');
      return cached;
    }

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

    // Cache for 5 minutes — invalidated on recordApproval/recordSkip
    await redis.set(CALIBRATION_CACHE_KEY, calibration, 'EX', CALIBRATION_CACHE_TTL);

    return calibration;
  } catch (err) {
    logger.warn('Failed to get feedback calibration', { error: err });
    return '';
  }
}

/**
 * Recalibrate settings.dimensionWeights automatically based on approval vs skip history.
 */
export async function recalibrateWeights(): Promise<void> {
  try {
    const { validateAndNormalizeWeights } = require('./scorer');
    const { prisma } = require('../../core/prisma');

    logger.info('Starting adaptive weight recalibration...');
    
    // Fetch last 30 feedback signals
    const [approvedRaw, skippedRaw] = await Promise.all([
      redis.lrange(APPROVED_KEY, 0, 29),
      redis.lrange(SKIPPED_KEY, 0, 29),
    ]);

    const approved = approvedRaw.map((s) => JSON.parse(s) as FeedbackSignal);
    const skipped = skippedRaw.map((s) => JSON.parse(s) as FeedbackSignal);

    // Require at least 5 approved signals to recalibrate
    if (approved.length < 5) {
      logger.info(`Not enough feedback signals yet to recalibrate weights (approved: ${approved.length}/5)`);
      return;
    }

    const settings = await prisma.settings.findFirst();
    if (!settings) {
      logger.warn('Settings not found during weight recalibration');
      return;
    }

    const defaultWeights = {
      techStack: 0.15,
      seniorityFit: 0.30,
      domainFit: 0.10,
      compensationFit: 0.25,
      companyTier: 0.20,
    };

    const currentWeights = (settings.dimensionWeights as Record<string, number> | null) || defaultWeights;

    const dimensions = ['techStack', 'seniorityFit', 'domainFit', 'compensationFit', 'companyTier'] as const;
    type Dim = typeof dimensions[number];

    const approvedAvgs: Record<Dim, number> = {} as any;
    const skippedAvgs: Record<Dim, number> = {} as any;

    for (const dim of dimensions) {
      const approvedVals = approved.map(s => s.dimensions?.[dim] ?? 50);
      approvedAvgs[dim] = approvedVals.reduce((a, b) => a + b, 0) / approvedVals.length;

      // If no skipped signals, default to 50 for comparison
      const skippedVals = skipped.length > 0 ? skipped.map(s => s.dimensions?.[dim] ?? 50) : [50];
      skippedAvgs[dim] = skippedVals.reduce((a, b) => a + b, 0) / skippedVals.length;
    }

    const learningRate = 0.3;
    const newWeights: Record<string, number> = {};

    for (const dim of dimensions) {
      const d = approvedAvgs[dim] - skippedAvgs[dim];
      // Adjust weight based on delta. If delta is positive, we increase weight. If negative, decrease.
      // We clip raw weight to at least 0.05 to ensure all dimensions are considered.
      const rawAdjusted = Math.max(0.05, currentWeights[dim] * (1 + learningRate * (d / 100)));
      newWeights[dim] = rawAdjusted;
    }

    // Normalize
    const sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
    const normalizedWeights = Object.fromEntries(
      Object.entries(newWeights).map(([k, v]) => [k, v / sum])
    );

    // Apply constraints
    const validatedWeights = validateAndNormalizeWeights(normalizedWeights, defaultWeights);

    logger.info('Adaptive weight recalibration computed new weights:', validatedWeights);

    await prisma.settings.update({
      where: { id: settings.id },
      data: { dimensionWeights: validatedWeights },
    });

    // Invalidate calibration cache
    await redis.del(CALIBRATION_CACHE_KEY);

    logger.info('✅ Successfully recalibrated and saved settings.dimensionWeights');
  } catch (err) {
    logger.error('Failed to recalibrate weights', { error: err });
  }
}
