import { Router, Request, Response } from 'express';
import { prisma } from '../core/prisma';
import { tailorResume, generateCoverLetter } from '../services/ai-engine/tailor';
import { logger } from '../core/logger';
import { z } from 'zod';
import { ApplicationStatus } from '@prisma/client';

export const applicationsRouter = Router();

const paramId = (req: Request, param: string): string =>
  Array.isArray(req.params[param]) ? req.params[param][0] : req.params[param] as string;

// GET /api/applications — list all applications
applicationsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { status } = req.query as Record<string, string>;
    const applications = await prisma.application.findMany({
      where: status ? { status: status as ApplicationStatus } : undefined,
      include: {
        job: { select: { title: true, company: true, location: true, fitScore: true, source: true } },
        emailEvents: { orderBy: { receivedAt: 'desc' }, take: 5 },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(applications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// GET /api/applications/:id
applicationsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const app = await prisma.application.findUnique({
      where: { id: paramId(req, 'id') },
      include: {
        job: true,
        emailEvents: { orderBy: { receivedAt: 'desc' } },
      },
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });
    res.json(app);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

// POST /api/applications/:jobId/tailor — tailor resume for a job
applicationsRouter.post('/:jobId/tailor', async (req: Request, res: Response) => {
  try {
    const result = await tailorResume(paramId(req, 'jobId'));
    if (!result) return res.status(500).json({ error: 'Tailoring failed' });
    res.json(result);
  } catch (error) {
    logger.error('Resume tailoring error', { error });
    res.status(500).json({ error: 'Failed to tailor resume' });
  }
});

// POST /api/applications/:jobId/cover-letter — generate cover letter
applicationsRouter.post('/:jobId/cover-letter', async (req: Request, res: Response) => {
  try {
    const result = await generateCoverLetter(paramId(req, 'jobId'));
    if (!result) return res.status(500).json({ error: 'Cover letter generation failed' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate cover letter' });
  }
});

// PATCH /api/applications/:id — update application (cover letter, notes, status)
const updateAppSchema = z.object({
  coverLetter: z.string().optional(),
  tailoredResumeLatex: z.string().optional(),
  customNotes: z.string().optional(),
  formAnswers: z.record(z.string()).optional(),
  status: z.enum(['PENDING', 'APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN']).optional(),
  salaryExpectation: z.string().optional(),
});

applicationsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const data = updateAppSchema.parse(req.body);
    const app = await prisma.application.update({
      where: { id: paramId(req, 'id') },
      data: {
        ...data,
        ...(data.status === 'APPLIED' ? { appliedAt: new Date() } : {}),
      },
    });
    res.json(app);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// GET /api/applications/by-job/:jobId
applicationsRouter.get('/by-job/:jobId', async (req: Request, res: Response) => {
  try {
    const app = await prisma.application.findUnique({
      where: { jobId: paramId(req, 'jobId') },
      include: { job: true, emailEvents: true },
    });
    if (!app) return res.status(404).json({ error: 'No application for this job' });
    res.json(app);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});
