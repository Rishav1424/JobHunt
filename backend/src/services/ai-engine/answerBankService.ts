import { prisma } from '../../core/prisma';
import { generateEmbedding, cosineSimilarity } from '../../core/gemini';
import { logger } from '../../core/logger';

const SEMANTIC_CACHE_THRESHOLD = 0.90; // Only reuse if similarity is >= 90%

/**
 * Check if the answer bank contains a semantically similar question.
 * Returns the cached answer if found, otherwise null.
 */
export async function lookupCachedAnswer(question: string): Promise<string | null> {
  try {
    logger.debug(`Looking up cached answer for question: "${question.slice(0, 60)}..."`);

    // 1. Generate query embedding
    const queryVector = await generateEmbedding(question);
    const vectorStr = `[${queryVector.join(',')}]`;

    // 2. Query nearest neighbor using pgvector
    const result = await prisma.$queryRaw<any[]>`
      SELECT question, answer,
             (1 - (embedding_vec <=> cast(${vectorStr} as vector))) AS similarity
      FROM "AnswerBank"
      ORDER BY embedding_vec <=> cast(${vectorStr} as vector)
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    const bestMatch = result[0];
    const bestSimilarity = Number(bestMatch.similarity || 0);

    // 3. Return if matches threshold
    if (bestSimilarity >= SEMANTIC_CACHE_THRESHOLD) {
      logger.info(
        `🎯 Semantic cache HIT! Found match: "${bestMatch.question.slice(0, 50)}..." (similarity: ${bestSimilarity.toFixed(4)})`
      );
      return bestMatch.answer;
    }

    logger.debug(
      `Cache miss. Best match was "${bestMatch.question.slice(0, 40)}..." (similarity: ${bestSimilarity.toFixed(4)})`
    );
    return null;
  } catch (error) {
    logger.error('Failed to lookup cached answer', { error });
    return null;
  }
}

/**
 * Save an answer to the AnswerBank, computing the embedding for the question.
 */
export async function saveAnswerToBank(question: string, answer: string): Promise<void> {
  try {
    logger.info(`Saving answer to bank for question: "${question.slice(0, 60)}..."`);

    // Generate embedding of the question
    const embedding = await generateEmbedding(question);

    // Upsert into DB
    const record = await prisma.answerBank.upsert({
      where: { question },
      create: {
        question,
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
