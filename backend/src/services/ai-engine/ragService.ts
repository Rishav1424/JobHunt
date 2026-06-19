import { prisma } from '../../core/prisma';
import { generateEmbedding, cosineSimilarity } from '../../core/gemini';
import { logger } from '../../core/logger';

export interface RetrievalResult {
  id: string;
  category: string;
  title: string | null;
  content: string;
  similarity: number;
}

/**
 * Retrieve the top K relevant knowledge chunks for a given query string.
 * Performs in-memory cosine similarity matching over the database chunks.
 */
export async function retrieveRelevantContext(
  query: string,
  limit = 3,
  categoryFilter?: string
): Promise<RetrievalResult[]> {
  try {
    logger.debug(`Retrieving context for query: "${query}" (limit=${limit})`);

    // 1. Generate embedding for the query
    const queryVector = await generateEmbedding(query);

    // 2. Fetch knowledge chunks from database
    const whereClause = categoryFilter ? { category: categoryFilter } : {};
    const chunks = await prisma.knowledgeChunk.findMany({
      where: whereClause,
    });

    if (chunks.length === 0) {
      logger.warn('No knowledge chunks found in the database. Run db:seed.');
      return [];
    }

    // 3. Compute cosine similarity for each chunk in memory
    const results: RetrievalResult[] = chunks
      .map((chunk) => {
        const similarity = cosineSimilarity(queryVector, chunk.embedding);
        return {
          id: chunk.id,
          category: chunk.category,
          title: chunk.title,
          content: chunk.content,
          similarity,
        };
      })
      // 4. Sort descending by similarity
      .sort((a, b) => b.similarity - a.similarity);

    // 5. Take top K results
    const topResults = results.slice(0, limit);

    logger.debug(
      `Retrieved ${topResults.length} chunks. Top match: "${topResults[0]?.title || topResults[0]?.category}" (similarity: ${topResults[0]?.similarity.toFixed(4)})`
    );

    return topResults;
  } catch (error) {
    logger.error('Failed to retrieve context from knowledgebase', { error });
    return [];
  }
}

/**
 * Helper to build a formatted prompt context block from retrieved chunks.
 */
export function formatRetrievalContext(chunks: RetrievalResult[]): string {
  if (chunks.length === 0) return 'No specific background context available.';

  return chunks
    .map(
      (chunk, index) =>
        `[Context Chunk #${index + 1}: ${chunk.title || chunk.category.toUpperCase()}]\n${chunk.content}`
    )
    .join('\n\n---\n\n');
}
