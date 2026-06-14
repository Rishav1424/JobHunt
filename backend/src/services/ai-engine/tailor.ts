import { proModel, flashModel, parseGeminiJSON } from '../../core/gemini';
import { prisma } from '../../core/prisma';
import { logger } from '../../core/logger';

export interface TailoredResume {
  modifiedLatex: string;
  changesSummary: string[];       // human-readable list of what changed
  highlightedSkills: string[];    // skills from JD now emphasized
  tailoredSummary: string;        // new summary paragraph
}

/**
 * Tailor the candidate's base resume to a specific job.
 * Uses Gemini 1.5 Pro for maximum quality.
 * Returns modified LaTeX + change summary for review.
 *
 * HARD RULE: Never fabricate. Only reframe existing facts.
 */
export async function tailorResume(jobId: string): Promise<TailoredResume | null> {
  try {
    const [job, profile] = await Promise.all([
      prisma.job.findUnique({ where: { id: jobId } }),
      prisma.userProfile.findFirst(),
    ]);

    if (!job || !profile) return null;

    logger.info(`Tailoring resume for job: ${job.title} @ ${job.company}`);

    const prompt = buildTailoringPrompt(
      profile.baseResumeLatex,
      job.title,
      job.company,
      job.description,
      job.fitAnalysis as { keywordsMatched?: string[]; gaps?: string[] } | null
    );

    const result = await proModel.generateContent(prompt);
    const responseText = result.response.text();

    const tailored = parseGeminiJSON<TailoredResume>(responseText);

    // Validate the output still compiles (basic LaTeX structure check)
    if (!tailored.modifiedLatex.includes('\\begin{document}')) {
      throw new Error('Invalid LaTeX output from Gemini');
    }

    // Save to DB — upsert to handle both create and update
    await prisma.application.upsert({
      where: { jobId },
      create: {
        jobId,
        tailoredResumeLatex: tailored.modifiedLatex,
        changesSummary: tailored.changesSummary,
      },
      update: {
        tailoredResumeLatex: tailored.modifiedLatex,
        changesSummary: tailored.changesSummary,
      },
    });

    logger.info(`Resume tailored: ${tailored.changesSummary.length} changes made`);
    return tailored;
  } catch (error) {
    logger.error(`Error tailoring resume for job ${jobId}`, { error });
    return null;
  }
}

function buildTailoringPrompt(
  baseLatex: string,
  jobTitle: string,
  company: string,
  jobDescription: string,
  fitAnalysis: { keywordsMatched?: string[]; gaps?: string[] } | null
): string {
  const keywordsMatched = fitAnalysis?.keywordsMatched?.join(', ') || '';
  const gaps = fitAnalysis?.gaps?.join(', ') || '';

  return `You are an expert resume writer for software engineers. Your job is to tailor a LaTeX resume to a specific job posting.

## CRITICAL RULES:
1. NEVER fabricate skills, experiences, or achievements
2. Only reframe, reorder, or reword existing content
3. Keep all LaTeX formatting intact — the output must compile
4. Do NOT add new bullet points with false information
5. Keep the overall structure: Header, Summary, Experience, Education, Skills, Projects, Achievements

## Base Resume (LaTeX):
${baseLatex}

## Target Job: ${jobTitle} at ${company}

## Job Description:
${jobDescription.slice(0, 4000)}

## Keywords to emphasize (already in resume): ${keywordsMatched}
## Gaps to address through reframing (be subtle): ${gaps}

## What to change:
1. **Summary**: Rewrite to mention "${jobTitle}" and "${company}" — tailor language to JD
2. **Skills**: Reorder skills to put JD-relevant ones first
3. **Experience bullets**: Rewrite 1-2 bullets per experience to use JD vocabulary (same facts, JD language)
4. **Projects**: Reorder to put most relevant project first
5. Keep ALL dates, metrics, links, and factual content unchanged

Respond with ONLY valid JSON (no markdown):
{
  "modifiedLatex": "<complete modified LaTeX document as a string>",
  "changesSummary": ["<change 1>", "<change 2>", ...],
  "highlightedSkills": ["<skill 1>", ...],
  "tailoredSummary": "<the new summary paragraph text>"
}`;
}

// ─── Cover Letter ─────────────────────────────────────────────────────────────

export interface CoverLetter {
  text: string;       // plain text, 3 paragraphs
  subject: string;    // email subject line
}

/**
 * Generate a personalized cover letter using Gemini Flash.
 */
export async function generateCoverLetter(jobId: string): Promise<CoverLetter | null> {
  try {
    const [job, profile] = await Promise.all([
      prisma.job.findUnique({ where: { id: jobId } }),
      prisma.userProfile.findFirst(),
    ]);

    if (!job || !profile) return null;

    const fitAnalysis = job.fitAnalysis as { strengths?: string[] } | null;
    const strengths = fitAnalysis?.strengths?.slice(0, 3).join('; ') || '';

    const prompt = `Write a professional cover letter for a software engineering job application.

Candidate: ${profile.name}
Email: ${profile.email}
Role: ${job.title}
Company: ${job.company}
Location: ${job.location}

Key strengths matching this role:
${strengths}

Candidate background:
- SDE Intern at Samsung R&D (Jan 2026–Present): built real-time distributed audio systems with PTP sync, OPUS codec, and FEC
- Built Distributed Chess Platform (Spring Boot, Redis, WebSocket, Docker) — live at chessclient.onrender.com
- Built CampusCord (Node.js, Socket.IO, PostgreSQL) — 500+ concurrent users
- NIT Durgapur, B.Tech EE, graduating June 2026
- 500+ LeetCode problems, JEE Advanced Top 1%

Job Description (excerpt):
${job.description.slice(0, 1500)}

Write a 3-paragraph cover letter:
1. Opening: Express enthusiasm for the specific role + company, mention 1 key achievement
2. Body: Connect 2-3 specific experiences/projects to the job requirements
3. Close: Express eagerness to contribute, request interview

Keep it concise (< 300 words), professional, and authentic.
Do NOT use generic phrases like "I am writing to apply".
Do NOT use "I am a passionate developer".

Respond with ONLY valid JSON:
{
  "subject": "Application for ${job.title} — Rishav Sharma",
  "text": "<full cover letter, use \\n for line breaks>"
}`;

    const result = await flashModel.generateContent(prompt);
    const coverLetter = parseGeminiJSON<CoverLetter>(result.response.text());

    // Save to DB
    await prisma.application.upsert({
      where: { jobId },
      create: { jobId, coverLetter: coverLetter.text },
      update: { coverLetter: coverLetter.text },
    });

    return coverLetter;
  } catch (error) {
    logger.error(`Error generating cover letter for job ${jobId}`, { error });
    return null;
  }
}
