import { prisma } from '../../core/prisma';
import { redis } from '../../core/redis';
import { logger } from '../../core/logger';
import { formatProfileJsonToText } from './scorer';

const CACHE_KEY = 'candidate:rich_context';
const CACHE_TTL = 30 * 60; // 30 minutes in seconds

/**
 * Assemble a rich Candidate Context string (~2000 tokens) using the profile table and KnowledgeChunks.
 * Caches the result in Redis to prevent database roundtrips.
 */
export async function getCandidateRichContext(): Promise<string> {
  try {
    // Check Redis cache first
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      logger.debug('Reusing cached candidate rich context from Redis');
      return cached;
    }

    logger.info('Building fresh candidate rich context...');
    const [profile, settings, chunks] = await Promise.all([
      prisma.userProfile.findFirst(),
      prisma.settings.findFirst(),
      prisma.knowledgeChunk.findMany({
        orderBy: { category: 'asc' },
      }),
    ]);

    if (!profile) {
      return 'No candidate profile found. Run npm run seed:profile.';
    }

    let contextText = `## Candidate Profile: ${profile.name}\n`;
    contextText += `- Email: ${profile.email}\n`;
    contextText += `- Phone: ${profile.phone}\n`;
    contextText += `- Location: ${profile.location}\n`;
    contextText += `- LinkedIn: ${profile.linkedinUrl || 'N/A'}\n`;
    contextText += `- GitHub: ${profile.githubUrl || 'N/A'}\n\n`;

    // Add structured profileJson if available
    const structuredText = formatProfileJsonToText(profile);
    if (structuredText) {
      contextText += structuredText + '\n\n';
    }

    if (settings) {
      contextText += `## Career Settings & Preferences:\n`;
      contextText += `- Minimum Expected Salary: ${settings.minSalaryLpa} LPA\n`;
      contextText += `- Target Roles: ${settings.targetRoles.join(', ')}\n`;
      contextText += `- Target Locations: ${settings.targetLocations.join(', ')}\n`;
      contextText += `- Dream Companies: ${settings.targetCompanies.join(', ')}\n\n`;
    }

    // Add Knowledge Chunks grouped by category
    contextText += `## Detailed Background & Work Experience Chunks:\n`;
    const groupedChunks: Record<string, typeof chunks> = {};
    for (const chunk of chunks) {
      if (!groupedChunks[chunk.category]) {
        groupedChunks[chunk.category] = [];
      }
      groupedChunks[chunk.category].push(chunk);
    }

    for (const [category, items] of Object.entries(groupedChunks)) {
      contextText += `### Category: ${category.toUpperCase()}\n`;
      for (const item of items) {
        contextText += `#### ${item.title || 'Overview'}\n${item.content}\n\n`;
      }
    }

    // Cache in Redis
    await redis.set(CACHE_KEY, contextText, 'EX', CACHE_TTL);
    logger.info('✅ Candidate rich context built and cached in Redis');

    return contextText;
  } catch (error) {
    logger.error('Failed to build candidate rich context', { error });
    return 'Error assembling candidate profile context.';
  }
}

/**
 * Invalidate the cached rich context.
 */
export async function invalidateCandidateContext(): Promise<void> {
  try {
    await redis.del(CACHE_KEY);
    logger.debug('Candidate rich context cache invalidated');
  } catch (error) {
    logger.error('Failed to invalidate candidate context cache', { error });
  }
}
