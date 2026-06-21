import { prisma } from '../../core/prisma';
import { generateEmbedding, cosineSimilarity, proModel, parseGeminiJSON, callWithRetry } from '../../core/gemini';
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
    const vectorStr = `[${queryVector.join(',')}]`;

    // 2. Fetch knowledge chunks from database using pgvector
    let chunks: any[];
    if (categoryFilter) {
      chunks = await prisma.$queryRaw<any[]>`
        SELECT id, category, title, content,
               (1 - (embedding_vec <=> cast(${vectorStr} as vector))) AS similarity
        FROM "KnowledgeChunk"
        WHERE category = ${categoryFilter}
        ORDER BY embedding_vec <=> cast(${vectorStr} as vector)
        LIMIT ${limit}
      `;
    } else {
      chunks = await prisma.$queryRaw<any[]>`
        SELECT id, category, title, content,
               (1 - (embedding_vec <=> cast(${vectorStr} as vector))) AS similarity
        FROM "KnowledgeChunk"
        ORDER BY embedding_vec <=> cast(${vectorStr} as vector)
        LIMIT ${limit}
      `;
    }

    if (chunks.length === 0) {
      logger.warn('No knowledge chunks found in the database. Run db:seed.');
      return [];
    }

    const results: RetrievalResult[] = chunks.map((chunk) => ({
      id: chunk.id,
      category: chunk.category,
      title: chunk.title,
      content: chunk.content,
      similarity: Number(chunk.similarity || 0),
    }));

    logger.debug(
      `Retrieved ${results.length} chunks. Top match: "${results[0]?.title || results[0]?.category}" (similarity: ${results[0]?.similarity.toFixed(4)})`
    );

    return results;
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

/**
 * Re-seed the KnowledgeChunk database table from the LaTeX resume.
 * This runs in the background to ensure updates to internships/projects flow into RAG autofills.
 */
export async function reseedKnowledgeChunks(latex: string): Promise<void> {
  if (!latex || latex.trim().startsWith('% Resume not found')) {
    logger.warn('⚠️ Skipping KnowledgeChunk reseeding: BaseResume.latex is not available or empty.');
    return;
  }
  logger.info('🧠 Parsing resume into KnowledgeChunks in background using Gemini...');
  const parserPrompt = `
You are an expert resume parser. Analyze the following LaTeX resume and break it down into a list of structured knowledge chunks representing projects, work experience, education, technical skills, and achievements.
For each chunk, output:
- category: "project" | "experience" | "technical_strength" | "education" | "other"
- title: A short string identifying the item (e.g. company name, project name, or degree). Null if not applicable.
- content: The content/bullet points of this item, converted to clean, readable markdown (no raw LaTeX tags like \\begin{itemize}, \\item, etc. - parse them into clean markdown bullet points or paragraphs). Include all key details, numbers, and technologies.

Resume LaTeX:
${latex}

Return a JSON array of objects with the fields: category, title, and content.
`;

  try {
    const response = await callWithRetry(async () => {
      const result = await proModel.generateContent(parserPrompt);
      return result.response.text();
    }, 3, 'parseResumeToChunks');

    interface ParsedChunk {
      category: string;
      title: string | null;
      content: string;
    }

    const parsedChunks = parseGeminiJSON<ParsedChunk[]>(response);
    logger.info(`   Parsed ${parsedChunks.length} chunks. Generating embeddings...`);

    // Clear existing chunks to avoid duplicates
    await prisma.knowledgeChunk.deleteMany();

    // Task 12: Process embeddings in parallel batches of 3 instead of serial
    const CHUNK_BATCH_SIZE = 3;
    for (let i = 0; i < parsedChunks.length; i += CHUNK_BATCH_SIZE) {
      const batch = parsedChunks.slice(i, i + CHUNK_BATCH_SIZE);
      logger.info(`   Generating embeddings for chunks ${i + 1}-${Math.min(i + CHUNK_BATCH_SIZE, parsedChunks.length)}/${parsedChunks.length}...`);

      await Promise.all(
        batch.map(async (chunk) => {
          const embedding = await generateEmbedding(chunk.content);
          const record = await prisma.knowledgeChunk.create({
            data: {
              category: chunk.category,
              title: chunk.title,
              content: chunk.content,
              embedding,
            },
          });

          // Sync pgvector column
          const vectorStr = `[${embedding.join(',')}]`;
          await prisma.$executeRawUnsafe(
            'UPDATE "KnowledgeChunk" SET embedding_vec = cast($1 as vector) WHERE id = $2',
            vectorStr,
            record.id
          );
        })
      );
    }
    logger.info('✅ KnowledgeChunks re-seeded successfully!');
  } catch (err) {
    logger.error('❌ Failed to parse and re-seed KnowledgeChunks', { error: err });
  }
}

