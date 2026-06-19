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

    // 2. Load all cached answers from database
    const cachedAnswers = await prisma.answerBank.findMany();

    if (cachedAnswers.length === 0) {
      return null;
    }

    // 3. Compute similarities in memory
    let bestMatch: typeof cachedAnswers[0] | null = null;
    let bestSimilarity = -1;

    for (const record of cachedAnswers) {
      const similarity = cosineSimilarity(queryVector, record.embedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = record;
      }
    }

    // 4. Return if matches threshold
    if (bestMatch && bestSimilarity >= SEMANTIC_CACHE_THRESHOLD) {
      logger.info(
        `🎯 Semantic cache HIT! Found match: "${bestMatch.question.slice(0, 50)}..." (similarity: ${bestSimilarity.toFixed(4)})`
      );
      return bestMatch.answer;
    }

    logger.debug(
      bestMatch
        ? `Cache miss. Best match was "${bestMatch.question.slice(0, 40)}..." (similarity: ${bestSimilarity.toFixed(4)})`
        : 'Cache miss. No answers in bank.'
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
    await prisma.answerBank.upsert({
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

    logger.info('✅ Answer saved to AnswerBank.');
  } catch (error) {
    logger.error('Failed to save answer to AnswerBank', { error });
  }
}
