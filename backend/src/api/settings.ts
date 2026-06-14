import { Router, Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { updateSchedule } from '../jobs/scheduler';
import { ensureProfileEmbedding } from '../services/ai-engine/scorer';
import { logger } from '../core/logger';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

export const settingsRouter = Router();

// GET /api/settings — get current settings
settingsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    let settings = await prisma.settings.findFirst();
    if (!settings) {
      // Initialize with defaults
      settings = await prisma.settings.create({ data: {} });
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PATCH /api/settings — update settings
const updateSettingsSchema = z.object({
  minSalaryLpa: z.number().min(0).max(200).optional(),
  maxSalaryLpa: z.number().nullable().optional(),
  targetRoles: z.array(z.string()).optional(),
  targetLocations: z.array(z.string()).optional(),
  remoteOnly: z.boolean().optional(),
  fitScoreThreshold: z.number().min(0).max(100).optional(),
  scrapeIntervalHours: z.number().min(1).max(24).optional(),
  enabledSources: z.record(z.boolean()).optional(),
  blacklistedCompanies: z.array(z.string()).optional(),
  targetCompanies: z.array(z.string()).optional(),
});

settingsRouter.patch('/', async (req: Request, res: Response) => {
  try {
    const data = updateSettingsSchema.parse(req.body);
    const current = await prisma.settings.findFirst();
    
    const updated = current
      ? await prisma.settings.update({ where: { id: current.id }, data })
      : await prisma.settings.create({ data });

    // If scrape interval changed, update the scheduler
    if (data.scrapeIntervalHours) {
      await updateSchedule(data.scrapeIntervalHours);
    }

    res.json(updated);
  } catch (error) {
    logger.error('PATCH /api/settings error', { error });
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// GET /api/settings/profile — get user profile
settingsRouter.get('/profile', async (_req: Request, res: Response) => {
  try {
    let profile = await prisma.userProfile.findFirst();
    if (!profile) {
      // Initialize from base resume file
      const resumePath = path.resolve(process.env.STORAGE_PATH || './storage', '../BaseResume.latex');
      let baseResumeLatex = '';
      try {
        baseResumeLatex = fs.readFileSync(resumePath, 'utf-8');
      } catch {
        baseResumeLatex = '% Base resume not found. Please update.';
      }

      profile = await prisma.userProfile.create({
        data: {
          baseResumeLatex,
          skills: [
            'Java', 'JavaScript', 'TypeScript', 'Python', 'C++',
            'Spring Boot', 'Node.js', 'React.js', 'Express.js',
            'PostgreSQL', 'MongoDB', 'Redis', 'Docker',
            'WebSocket', 'Socket.IO', 'REST APIs', 'System Design',
          ],
        },
      });
    }
    // Don't send the full embedding vector to the client
    const { profileEmbedding, ...profileData } = profile;
    res.json({ ...profileData, hasEmbedding: profileEmbedding.length > 0 });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PATCH /api/settings/profile — update user profile / resume
const updateProfileSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  githubUrl: z.string().url().optional(),
  baseResumeLatex: z.string().optional(),
  skills: z.array(z.string()).optional(),
});

settingsRouter.patch('/profile', async (req: Request, res: Response) => {
  try {
    const data = updateProfileSchema.parse(req.body);
    const profile = await prisma.userProfile.findFirst();

    const updated = profile
      ? await prisma.userProfile.update({
          where: { id: profile.id },
          data: {
            ...data,
            // If resume changed, clear embedding so it gets recomputed
            ...(data.baseResumeLatex
              ? { profileEmbedding: [], embeddingComputedAt: null }
              : {}),
          },
        })
      : await prisma.userProfile.create({ data: { ...data, baseResumeLatex: data.baseResumeLatex || '' } });

    // Recompute embedding in background if resume changed
    if (data.baseResumeLatex) {
      ensureProfileEmbedding().catch((err) =>
        logger.error('Failed to recompute profile embedding', { err })
      );
    }

    const { profileEmbedding, ...profileData } = updated;
    res.json(profileData);
  } catch (error) {
    logger.error('PATCH /api/settings/profile error', { error });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});
