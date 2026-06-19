import { redis } from './redis';
import { logger } from './logger';

/**
 * Redis-backed Circuit Breaker for scrapers.
 *
 * States:
 *   CLOSED  → scraper is healthy, run normally
 *   OPEN    → scraper has failed 3+ times, skip for COOLDOWN_MS
 *   HALF-OPEN → cooldown elapsed, allow one test run
 *
 * Keys in Redis:
 *   scraper:health:<name>:failures  (integer)
 *   scraper:health:<name>:state     ('CLOSED' | 'OPEN')
 *   scraper:health:<name>:openedAt  (unix timestamp ms)
 */

const FAILURE_THRESHOLD = 3;        // failures before opening circuit
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours before HALF-OPEN retry
const KEY_TTL_S = 24 * 60 * 60;    // expire redis keys after 24h (self-healing)

function key(name: string, field: string) {
  return `scraper:health:${name}:${field}`;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF-OPEN';

export interface ScraperHealth {
  state: CircuitState;
  failures: number;
  openedAt?: number;
}

/**
 * Check if a scraper is allowed to run.
 * Returns the current circuit state.
 */
export async function canRun(name: string): Promise<{ allowed: boolean; state: CircuitState }> {
  try {
    const [stateRaw, failuresRaw, openedAtRaw] = await Promise.all([
      redis.get(key(name, 'state')),
      redis.get(key(name, 'failures')),
      redis.get(key(name, 'openedAt')),
    ]);

    const state = (stateRaw as CircuitState) || 'CLOSED';
    const failures = parseInt(failuresRaw || '0', 10);
    const openedAt = openedAtRaw ? parseInt(openedAtRaw, 10) : null;

    if (state === 'CLOSED') {
      return { allowed: true, state: 'CLOSED' };
    }

    if (state === 'OPEN') {
      if (openedAt && Date.now() - openedAt >= COOLDOWN_MS) {
        // Cooldown elapsed → transition to HALF-OPEN (allow one test)
        await redis.set(key(name, 'state'), 'HALF-OPEN');
        logger.info(`Circuit breaker [${name}]: OPEN → HALF-OPEN (cooldown elapsed, testing...)`);
        return { allowed: true, state: 'HALF-OPEN' };
      }
      const remaining = openedAt ? Math.ceil((COOLDOWN_MS - (Date.now() - openedAt)) / 60000) : '?';
      logger.warn(`Circuit breaker [${name}]: OPEN — skipping. (${remaining}min remaining)`);
      return { allowed: false, state: 'OPEN' };
    }

    // HALF-OPEN: allow the run
    return { allowed: true, state: 'HALF-OPEN' };
  } catch (err) {
    // If Redis is down, fail open (allow scraper to run)
    logger.warn(`Circuit breaker Redis error for [${name}], failing open`, { error: err });
    return { allowed: true, state: 'CLOSED' };
  }
}

/**
 * Record a successful scraper run — resets the circuit breaker.
 */
export async function recordSuccess(name: string): Promise<void> {
  try {
    const state = await redis.get(key(name, 'state'));
    if (state === 'HALF-OPEN') {
      logger.info(`Circuit breaker [${name}]: HALF-OPEN → CLOSED (recovery confirmed)`);
    }
    await Promise.all([
      redis.set(key(name, 'state'), 'CLOSED', 'EX', KEY_TTL_S),
      redis.set(key(name, 'failures'), '0', 'EX', KEY_TTL_S),
      redis.del(key(name, 'openedAt')),
    ]);
  } catch (err) {
    logger.warn(`Circuit breaker recordSuccess failed for [${name}]`, { error: err });
  }
}

/**
 * Record a scraper failure. Opens the circuit after FAILURE_THRESHOLD failures.
 */
export async function recordFailure(name: string, reason: string): Promise<void> {
  try {
    const failuresRaw = await redis.get(key(name, 'failures'));
    const failures = parseInt(failuresRaw || '0', 10) + 1;

    await redis.set(key(name, 'failures'), String(failures), 'EX', KEY_TTL_S);
    logger.warn(`Circuit breaker [${name}]: failure ${failures}/${FAILURE_THRESHOLD} — ${reason}`);

    if (failures >= FAILURE_THRESHOLD) {
      await Promise.all([
        redis.set(key(name, 'state'), 'OPEN', 'EX', KEY_TTL_S),
        redis.set(key(name, 'openedAt'), String(Date.now()), 'EX', KEY_TTL_S),
      ]);
      logger.error(`Circuit breaker [${name}]: CLOSED → OPEN (${failures} failures). Will retry in 2 hours.`);
    }
  } catch (err) {
    logger.warn(`Circuit breaker recordFailure failed for [${name}]`, { error: err });
  }
}

/**
 * Get health status for all scrapers (for the health API).
 */
export async function getAllScraperHealth(): Promise<Record<string, ScraperHealth>> {
  const scraperNames = ['adzuna', 'remoteok', 'wellfound', 'instahyre', 'linkedin', 'naukri', 'ats', 'ycombinator'];
  const result: Record<string, ScraperHealth> = {};

  for (const name of scraperNames) {
    try {
      const [stateRaw, failuresRaw, openedAtRaw] = await Promise.all([
        redis.get(key(name, 'state')),
        redis.get(key(name, 'failures')),
        redis.get(key(name, 'openedAt')),
      ]);
      result[name] = {
        state: (stateRaw as CircuitState) || 'CLOSED',
        failures: parseInt(failuresRaw || '0', 10),
        openedAt: openedAtRaw ? parseInt(openedAtRaw, 10) : undefined,
      };
    } catch {
      result[name] = { state: 'CLOSED', failures: 0 };
    }
  }

  return result;
}
