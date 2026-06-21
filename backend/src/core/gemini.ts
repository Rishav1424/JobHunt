import { GoogleGenerativeAI, GenerativeModel, EmbedContentRequest } from '@google/generative-ai';
import { config } from './config';
import { logger } from './logger';

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);

// ─── Rate Limiter (15 RPM = 1 req / 4s) ──────────────────────────────────────
// Task 4: Redis-backed distributed sliding window limiter
// Uses a sorted set (gemini:rate_limit) with timestamps as scores.
// Falls back to in-process queue if Redis is unavailable.
const RATE_LIMIT_RPM = 15;
const MIN_INTERVAL_MS = Math.ceil((60 * 1000) / RATE_LIMIT_RPM); // 4000ms
const RATE_LIMIT_KEY = 'gemini:rate_limit';

// Fallback in-process serializer (used when Redis is unavailable)
let callQueue = Promise.resolve();

async function rateLimit(): Promise<void> {
  try {
    const { redis } = await import('./redis');
    const now = Date.now();
    const windowStart = now - 60_000;

    // Remove calls older than 60 seconds
    await redis.zremrangebyscore(RATE_LIMIT_KEY, '-inf', windowStart);

    // Count calls in the current window
    const count = await redis.zcard(RATE_LIMIT_KEY);

    if (count >= RATE_LIMIT_RPM) {
      // Calculate how long to wait for the oldest call to expire from the window
      const oldest = await redis.zrange(RATE_LIMIT_KEY, 0, 0, 'WITHSCORES');
      const oldestTs = oldest.length >= 2 ? parseInt(oldest[1], 10) : now - 60_000;
      const waitMs = Math.max(0, oldestTs + 60_000 - now + 100);
      logger.debug(`Gemini rate limit: ${count}/${RATE_LIMIT_RPM} RPM, waiting ${waitMs}ms...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    // Register this call in the sorted set with TTL
    await redis.zadd(RATE_LIMIT_KEY, now, `${now}-${Math.random()}`);
    await redis.expire(RATE_LIMIT_KEY, 65); // auto-expire set after 65s
  } catch (redisErr) {
    // Fallback: simple in-process delay
    logger.debug('Gemini rate limiter Redis unavailable, using in-process fallback', { error: redisErr });
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
  }
}

// ─── Retry with Backoff ───────────────────────────────────────────────────────
/**
 * Wraps any async Gemini call with exponential backoff retry.
 * Handles: 429 (rate limit), 503 (service unavailable), 500 (transient errors).
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  label = 'Gemini call'
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Serialize all Gemini calls through the rate limiter
      const result = await new Promise<T>((resolve, reject) => {
        callQueue = callQueue
          .then(() => rateLimit())
          .then(() => fn())
          .then(resolve)
          .catch(reject);
      });
      return result;
    } catch (error: unknown) {
      lastError = error;
      const errMsg = String((error as Error).message || error);

      // Determine if this is a retryable error
      const is429 = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
      const is503 = errMsg.includes('503') || errMsg.includes('Service Unavailable') || errMsg.includes('UNAVAILABLE');
      const is500 = errMsg.includes('500') || errMsg.includes('Internal Server Error');
      const isRetryable = is429 || is503 || is500;

      if (!isRetryable || attempt === maxAttempts) {
        logger.error(`${label} failed after ${attempt} attempt(s)`, { error: errMsg });
        throw error;
      }

      // Exponential backoff: 4s, 8s, 16s — with extra wait for rate limits
      const baseDelay = is429 ? 8000 : 4000;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`${label} attempt ${attempt}/${maxAttempts} failed (${is429 ? '429' : '5xx'}). Retrying in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

// ─── Models ───────────────────────────────────────────────────────────────────

// Flash: fast + cheap — for scoring, classification, cover letters
export const flashModel: GenerativeModel = genAI.getGenerativeModel({
  model: 'gemini-3.1-flash-lite',
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.2,   // lower = more consistent scoring
    topP: 0.8,
    maxOutputTokens: 3000,
  },
});

// Pro: best quality — for resume tailoring (long context)
export const proModel: GenerativeModel = genAI.getGenerativeModel({
  model: 'gemini-3.1-flash-lite',
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.4,
    topP: 0.9,
    maxOutputTokens: 8192,
  },
});

// Text model (no JSON enforcement) — for raw text generation (e.g. LaTeX resume)
export const textModel: GenerativeModel = genAI.getGenerativeModel({
  model: 'gemini-3.1-flash-lite',
  generationConfig: {
    temperature: 0.4,
    topP: 0.9,
    maxOutputTokens: 8192,
  },
});

// ─── Embedding ────────────────────────────────────────────────────────────────
const embeddingModelName = 'gemini-embedding-001';

/**
 * Generate embedding vector for a text string.
 * Uses retry wrapper — embeddings can also hit rate limits.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim() === '') {
    logger.warn('generateEmbedding: received empty or whitespace text, returning 768 zero values');
    return new Array(768).fill(0);
  }

  return callWithRetry(async () => {
    const model = genAI.getGenerativeModel({ model: embeddingModelName });
    const request: any = {
      content: { parts: [{ text }], role: 'user' },
      outputDimensionality: 768,
    };
    const result = await model.embedContent(request);
    return result.embedding.values;
  }, 3, 'generateEmbedding');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse structured JSON from Gemini's response safely.
 * Handles markdown code blocks that Gemini sometimes wraps output in.
 */
export function parseGeminiJSON<T>(text: string): T {
  // Strip any markdown fences
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // Sometimes Gemini returns multiple JSON objects — take the first complete one
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract JSON object from surrounding text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`Failed to parse Gemini JSON: ${cleaned.slice(0, 200)}`);
  }
}

/**
 * Compute cosine similarity between two vectors.
 * Returns value in [-1, 1]; for embeddings typically [0, 1].
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    logger.warn(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    return 0;
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

logger.info('🤖 Gemini client initialized (Flash + Embeddings + Retry + Rate Limiter)');
