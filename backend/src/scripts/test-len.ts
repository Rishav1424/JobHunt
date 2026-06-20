import { prisma } from '../core/prisma';

async function main() {
  const chunks = await prisma.knowledgeChunk.findMany({ take: 5 });
  for (const chunk of chunks) {
    console.log(`Chunk ${chunk.id}: embedding length = ${chunk.embedding.length}`);
  }
}

main().finally(() => prisma.$disconnect());
