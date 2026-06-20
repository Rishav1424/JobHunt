import { prisma } from '../core/prisma';
import { logger } from '../core/logger';

async function migrate() {
  logger.info('🚀 Starting pgvector database migration (768 dimensions)...');

  // 1. Enable extension
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
  logger.info('✅ Vector extension enabled');

  // 2. Drop existing index and columns if they exist to change size to 768
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS knowledge_chunk_vector_idx;');
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS answer_bank_vector_idx;');
  await prisma.$executeRawUnsafe('ALTER TABLE "KnowledgeChunk" DROP COLUMN IF EXISTS embedding_vec;');
  await prisma.$executeRawUnsafe('ALTER TABLE "AnswerBank" DROP COLUMN IF EXISTS embedding_vec;');
  await prisma.$executeRawUnsafe('ALTER TABLE "UserProfile" DROP COLUMN IF EXISTS profile_embedding_vec;');
  logger.info('✅ Existing columns dropped');

  // 3. Add columns with 768 dimensions
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "KnowledgeChunk" ADD COLUMN embedding_vec vector(768);
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "AnswerBank" ADD COLUMN embedding_vec vector(768);
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "UserProfile" ADD COLUMN profile_embedding_vec vector(768);
  `);
  logger.info('✅ Columns added with 768 dimensions');

  // 4. Create HNSW indexes
  await prisma.$executeRawUnsafe(`
    CREATE INDEX knowledge_chunk_vector_idx ON "KnowledgeChunk" USING hnsw (embedding_vec vector_cosine_ops);
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX answer_bank_vector_idx ON "AnswerBank" USING hnsw (embedding_vec vector_cosine_ops);
  `);
  logger.info('✅ HNSW indexes created');

  // 5. Migrate data from float arrays to vector columns
  // KnowledgeChunk
  const chunks = await prisma.knowledgeChunk.findMany({
    select: { id: true, embedding: true }
  });
  logger.info(`Migrating ${chunks.length} KnowledgeChunks...`);
  for (const chunk of chunks) {
    if (chunk.embedding && chunk.embedding.length > 0) {
      // If the existing array is 3072, slice it to 768, else use it
      const sliced = chunk.embedding.length > 768 ? chunk.embedding.slice(0, 768) : chunk.embedding;
      const vectorStr = `[${sliced.join(',')}]`;
      await prisma.$executeRawUnsafe(
        'UPDATE "KnowledgeChunk" SET embedding_vec = cast($1 as vector) WHERE id = $2',
        vectorStr,
        chunk.id
      );
    }
  }

  // AnswerBank
  const answers = await prisma.answerBank.findMany({
    select: { id: true, embedding: true }
  });
  logger.info(`Migrating ${answers.length} AnswerBank entries...`);
  for (const answer of answers) {
    if (answer.embedding && answer.embedding.length > 0) {
      const sliced = answer.embedding.length > 768 ? answer.embedding.slice(0, 768) : answer.embedding;
      const vectorStr = `[${sliced.join(',')}]`;
      await prisma.$executeRawUnsafe(
        'UPDATE "AnswerBank" SET embedding_vec = cast($1 as vector) WHERE id = $2',
        vectorStr,
        answer.id
      );
    }
  }

  // UserProfile
  const profiles = await prisma.userProfile.findMany({
    select: { id: true, profileEmbedding: true }
  });
  logger.info(`Migrating ${profiles.length} UserProfiles...`);
  for (const profile of profiles) {
    if (profile.profileEmbedding && profile.profileEmbedding.length > 0) {
      const sliced = profile.profileEmbedding.length > 768 ? profile.profileEmbedding.slice(0, 768) : profile.profileEmbedding;
      const vectorStr = `[${sliced.join(',')}]`;
      await prisma.$executeRawUnsafe(
        'UPDATE "UserProfile" SET profile_embedding_vec = cast($1 as vector) WHERE id = $2',
        vectorStr,
        profile.id
      );
    }
  }

  logger.info('🎉 Migration completed successfully!');
}

migrate()
  .catch((err) => logger.error('Migration failed', { error: err }))
  .finally(() => prisma.$disconnect());
