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
  mncCompanies: z.array(z.string()).optional(),
  tier1Startups: z.array(z.string()).optional(),
  serviceCompanies: z.array(z.string()).optional(),
  dimensionWeights: z.record(z.number()).optional(),
  minYoeCutoff: z.number().int().min(0).max(30).optional(),
  minSalaryCutoff: z.number().min(0).max(200).optional(),
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
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
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
      const candidatePaths = [
        '/app/BaseResume.latex',
        path.resolve(process.cwd(), '../BaseResume.latex'),
        path.resolve(__dirname, '../../../BaseResume.latex'),
        path.resolve(__dirname, '../../../../BaseResume.latex'),
      ];
      const resumePath = candidatePaths.find((p) => {
        try {
          return fs.existsSync(p) && fs.statSync(p).size > 0;
        } catch {
          return false;
        }
      }) || '';
      let baseResumeLatex = '';
      try {
        baseResumeLatex = resumePath ? fs.readFileSync(resumePath, 'utf-8') : '';
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
  profileJson: z.any().optional(),
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

    // Recompute embedding and reseed knowledge chunks in background if resume changed
    if (data.baseResumeLatex) {
      ensureProfileEmbedding().catch((err: any) =>
        logger.error('Failed to recompute profile embedding', { err })
      );
      const { reseedKnowledgeChunks } = require('../services/ai-engine/ragService');
      reseedKnowledgeChunks(data.baseResumeLatex).catch((err: any) =>
        logger.error('Failed to reseed knowledge chunks', { err })
      );
      const { recomputeClusterEmbeddings } = require('../services/ai-engine/scorer');
      recomputeClusterEmbeddings(updated.id).catch((err: any) =>
        logger.error('Failed to recompute cluster embeddings', { err })
      );
    } else if (data.profileJson) {
      const { recomputeClusterEmbeddings } = require('../services/ai-engine/scorer');
      recomputeClusterEmbeddings(updated.id).catch((err: any) =>
        logger.error('Failed to recompute cluster embeddings', { err })
      );
    }

    const { profileEmbedding, ...profileData } = updated;
    res.json(profileData);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    logger.error('PATCH /api/settings/profile error', { error });
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/settings/profile/compile — test compile LaTeX string
settingsRouter.post('/profile/compile', async (req: Request, res: Response) => {
  try {
    const { latex } = req.body;
    if (!latex) return res.status(400).json({ error: 'LaTeX content is required' });

    const { compileRawLatex } = require('../services/ai-engine/resumeCompiler');
    const result = await compileRawLatex(latex, 'Base_Resume');
    res.json(result);
  } catch (error) {
    logger.error('Failed to compile raw LaTeX', { error });
    res.status(500).json({ error: (error as Error).message || 'Failed to compile LaTeX' });
  }
});

// POST /api/settings/simulate-score — test score a job description
settingsRouter.post('/simulate-score', async (req: Request, res: Response) => {
  try {
    const { title, company, description } = req.body;
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and Description are required' });
    }

    // Build a transient job object
    const tempJob = {
      id: 'simulation',
      title,
      company: company || 'Simulation Corp',
      description,
      location: 'Remote',
      isRemote: true,
      salaryType: 'UNKNOWN' as const,
      source: 'SIMULATOR',
    };

    const { scoreJob } = require('../services/ai-engine/scorer');
    const result = await scoreJob(tempJob as any);
    res.json(result);
  } catch (error) {
    logger.error('Failed to simulate job score', { error });
    res.status(500).json({ error: (error as Error).message || 'Failed to simulate job score' });
  }
});

// POST /api/settings/onboard — onboard wizard submission
settingsRouter.post('/onboard', async (req: Request, res: Response) => {
  try {
    const { profileJson, qaPairs } = req.body;

    // Update UserProfile JSON
    const profile = await prisma.userProfile.findFirst();
    if (profile) {
      await prisma.userProfile.update({
        where: { id: profile.id },
        data: { profileJson },
      });
      // Recompute cluster embeddings in background
      const { recomputeClusterEmbeddings } = require('../services/ai-engine/scorer');
      recomputeClusterEmbeddings(profile.id).catch((err: any) =>
        logger.error('Failed to recompute cluster embeddings in onboarding', { err })
      );
    } else {
      const newProfile = await prisma.userProfile.create({
        data: {
          baseResumeLatex: '',
          profileJson,
          skills: []
        }
      });
      const { recomputeClusterEmbeddings } = require('../services/ai-engine/scorer');
      recomputeClusterEmbeddings(newProfile.id).catch((err: any) =>
        logger.error('Failed to recompute cluster embeddings in onboarding', { err })
      );
    }

    // Save Q&A pairs to AnswerBank
    if (Array.isArray(qaPairs)) {
      const { saveAnswerToBank } = require('../services/ai-engine/answerBankService');
      for (const pair of qaPairs) {
        if (pair.question && pair.answer) {
          await saveAnswerToBank(pair.question, pair.answer);
        }
      }
    }

    res.json({ success: true, message: 'Onboarding completed successfully' });
  } catch (error) {
    logger.error('Failed to submit onboarding data', { error });
    res.status(500).json({ error: 'Failed to save onboarding data' });
  }
});
