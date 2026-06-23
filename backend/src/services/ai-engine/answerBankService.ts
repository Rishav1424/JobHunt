import { prisma } from '../../core/prisma';
import { generateEmbedding, cosineSimilarity } from '../../core/gemini';
import { logger } from '../../core/logger';

const SEMANTIC_CACHE_THRESHOLD = 0.90; // Only reuse if similarity is >= 90%

/**
 * Check if a question is company-specific (e.g. mentions company name or relates to company interest/values).
 */
export function isCompanySpecific(question: string, company: string): boolean {
  const q = question.toLowerCase();
  const c = company.toLowerCase();
  
  const indicators = [
    'why this company',
    'why us',
    'why join',
    'why do you want to work',
    'why do you want this',
    'interest in',
    'cover letter',
    'this role',
    'our team',
    'about us',
    'our company',
    'values',
    'culture',
    'mission',
    c  // company name itself
  ];

  return indicators.some(ind => q.includes(ind));
}

/**
 * Check if the answer bank contains a semantically similar question.
 * Returns the cached answer if found, otherwise null.
 */
export async function lookupCachedAnswer(question: string, company?: string): Promise<string | null> {
  try {
    logger.debug(`Looking up cached answer for question: "${question.slice(0, 60)}..." (company: ${company || 'general'})`);

    // 1. Generate query embedding
    const queryVector = await generateEmbedding(question);
    const vectorStr = `[${queryVector.join(',')}]`;

    // 2. If company is specified, try looking up company-specific match first
    if (company) {
      const result = await prisma.$queryRaw<any[]>`
        SELECT question, answer, company,
               (1 - (embedding_vec <=> cast(${vectorStr} as vector))) AS similarity
        FROM "AnswerBank"
        WHERE company = ${company}
        ORDER BY embedding_vec <=> cast(${vectorStr} as vector)
        LIMIT 1
      `;
      if (result.length > 0) {
        const bestMatch = result[0];
        const bestSimilarity = Number(bestMatch.similarity || 0);
        if (bestSimilarity >= SEMANTIC_CACHE_THRESHOLD) {
          logger.info(
            `🎯 Semantic cache HIT (company-specific)! Found match: "${bestMatch.question.slice(0, 50)}..." (similarity: ${bestSimilarity.toFixed(4)})`
          );
          return bestMatch.answer;
        }
      }
    }

    // 3. Fall back to general match lookup
    const result = await prisma.$queryRaw<any[]>`
      SELECT question, answer, company,
             (1 - (embedding_vec <=> cast(${vectorStr} as vector))) AS similarity
      FROM "AnswerBank"
      WHERE company = ''
      ORDER BY embedding_vec <=> cast(${vectorStr} as vector)
      LIMIT 1
    `;
    if (result.length > 0) {
      const bestMatch = result[0];
      const bestSimilarity = Number(bestMatch.similarity || 0);
      if (bestSimilarity >= SEMANTIC_CACHE_THRESHOLD) {
        logger.info(
          `🎯 Semantic cache HIT (general)! Found match: "${bestMatch.question.slice(0, 50)}..." (similarity: ${bestSimilarity.toFixed(4)})`
        );
        return bestMatch.answer;
      }
    }

    logger.debug(`Cache miss for "${question.slice(0, 40)}..."`);
    return null;
  } catch (error) {
    logger.error('Failed to lookup cached answer', { error });
    return null;
  }
}

/**
 * Save an answer to the AnswerBank, computing the embedding for the question.
 */
export async function saveAnswerToBank(question: string, answer: string, company?: string): Promise<void> {
  try {
    const targetCompany = company && isCompanySpecific(question, company) ? company : '';
    logger.info(`Saving answer to bank for question: "${question.slice(0, 60)}..." (company: ${targetCompany || 'general'})`);

    // Generate embedding of the question
    const embedding = await generateEmbedding(question);

    // Upsert into DB
    const record = await prisma.answerBank.upsert({
      where: {
        question_company: {
          question,
          company: targetCompany,
        },
      },
      create: {
        question,
        company: targetCompany,
        answer,
        embedding,
      },
      update: {
        answer,
        embedding,
      },
    });

    // Sync pgvector column
    const vectorStr = `[${embedding.join(',')}]`;
    await prisma.$executeRawUnsafe(
      'UPDATE "AnswerBank" SET embedding_vec = cast($1 as vector) WHERE id = $2',
      vectorStr,
      record.id
    );

    logger.info('✅ Answer saved to AnswerBank.');
  } catch (error) {
    logger.error('Failed to save answer to AnswerBank', { error });
  }
}

/**
 * Task 28: Prune low-quality AnswerBank entries.
 * Removes entries that are:
 * 1. Older than 90 days (TTL-like behavior)
 * 2. Short/garbage answers (< 3 chars) e.g. "Y", "No" saved by mistake
 *
 * Call on startup or weekly to keep the bank clean and prevent quality decay.
 */
export async function pruneAnswerBank(): Promise<{ removed: number }> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Remove old entries
    const oldEntries = await prisma.answerBank.deleteMany({
      where: {
        updatedAt: { lt: ninetyDaysAgo },
      },
    });

    // Remove answers that are too short to be useful (< 3 chars: Y/N, ".", space etc.)
    // Use raw SQL for accurate length check — Prisma string comparison is lexicographic, not length-based
    const tinyAnswers = await prisma.$executeRaw`
      DELETE FROM "AnswerBank"
      WHERE length(trim(answer)) < 3
    `;

    const removed = oldEntries.count + Number(tinyAnswers);
    logger.info(`AnswerBank pruning complete: removed ${removed} stale/garbage entries`);
    return { removed };
  } catch (err) {
    logger.error('Failed to prune AnswerBank', { error: err });
    return { removed: 0 };
  }
}
