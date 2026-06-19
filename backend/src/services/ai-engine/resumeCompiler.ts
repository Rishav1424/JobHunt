import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { prisma } from '../../core/prisma';
import { textModel, callWithRetry } from '../../core/gemini';
import { logger } from '../../core/logger';
import { config } from '../../core/config';

const execPromise = util.promisify(exec);

/**
 * Generate a tailored LaTeX resume and compile it to PDF using pdflatex.
 * Returns the public URL of the compiled PDF.
 */
export async function compileTailoredResume(
  jobId: string,
  profileId = 'rishav-profile'
): Promise<{ pdfPath: string; pdfUrl: string; latex: string }> {
  logger.info(`Starting resume tailoring for jobId: ${jobId}`);

  // 1. Fetch profile and job data
  const profile = await prisma.userProfile.findUnique({
    where: { id: profileId },
  });
  if (!profile) {
    throw new Error('Candidate profile not found. Run db:seed.');
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  // Check database cache first
  const existingApp = await prisma.application.findUnique({
    where: { jobId },
  });
  if (existingApp && existingApp.tailoredResumePdfPath && existingApp.tailoredResumeLatex) {
    logger.info(`Found cached tailored resume in database for jobId: ${jobId}`);
    const pdfUrl = `${config.FRONTEND_URL.replace('3000', '4000')}/storage/${existingApp.tailoredResumePdfPath}`;
    return {
      pdfPath: existingApp.tailoredResumePdfPath,
      pdfUrl,
      latex: existingApp.tailoredResumeLatex,
    };
  }

  // 2. Instruct Gemini to tailor the LaTeX resume
  logger.info('Calling Gemini to tailor LaTeX resume contents...');
  const prompt = `
You are an expert technical resume writer. You are given a base LaTeX resume and a target job description.
Your goal is to tailor the resume to maximize the fit score for this job, while keeping all details 100% honest.

Tailoring Instructions:
1. **Summary**: Rewrite the Summary section to highlight experience and skills relevant to the target role. Keep it to 3 lines max.
2. **Technical Skills**: Re-order or highlight technologies that are critical for the job description. Keep it concise.
3. **Projects**: Review the projects section. Tailor the bullet points to highlight project challenges, scale, or metrics that align with what the job description is seeking. (e.g. if the job asks for WebSockets or high traffic, emphasize those in CampusCord / Chess Platform / E-Summit).
4. **Formatting Constraints**:
   - The compiled output MUST fit on exactly ONE page.
   - Do NOT modify the layout packages, geometry margins, custom color definitions, or headers in the preamble.
   - Keep the Education and Achievements sections unchanged.
   - Keep the output as syntactically correct LaTeX that compiles using pdflatex.
   - Do NOT include any markdown code blocks or backticks. Return ONLY the raw LaTeX document starting with \\documentclass and ending with \\end{document}.

Base LaTeX Resume:
${profile.baseResumeLatex}

Target Job Description:
Title: ${job.title}
Company: ${job.company}
Description:
${job.description}

Tailored LaTeX:
`;

  const tailoredResponse = await callWithRetry(async () => {
    const result = await textModel.generateContent(prompt);
    let text = result.response.text().trim();

    // Strip out markdown formatting if Gemini wrapped it in ```latex or ```
    text = text
      .replace(/^```latex\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    return text;
  }, 3, 'tailorResumeLatex');

  const docClassIndex = tailoredResponse.indexOf('\\documentclass');
  if (docClassIndex === -1) {
    logger.error('Gemini response did not contain \\documentclass. Full response prefix:', tailoredResponse.slice(0, 500));
    throw new Error('Gemini response did not return a valid LaTeX document structure.');
  }
  const cleanLatex = tailoredResponse.slice(docClassIndex);

  // 3. Setup temporary workspace and compile
  const tempId = `${job.company.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
  const tempDir = path.join(config.STORAGE_PATH, 'temp_compile');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const texFilePath = path.join(tempDir, `${tempId}.tex`);
  fs.writeFileSync(texFilePath, cleanLatex, 'utf-8');

  const outputDir = path.join(config.STORAGE_PATH, 'resumes');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let compiledSuccessfully = false;
  
  // 1. Try local pdflatex first if available
  let localPdflatexAvailable = false;
  try {
    await execPromise('pdflatex --version');
    localPdflatexAvailable = true;
  } catch {}

  if (localPdflatexAvailable) {
    logger.info('Compiling LaTeX to PDF via local pdflatex...');
    try {
      const compileCmd = `pdflatex -interaction=nonstopmode -output-directory="${outputDir}" "${texFilePath}"`;
      await execPromise(compileCmd);
      await execPromise(compileCmd);
      compiledSuccessfully = true;
      logger.info(`✅ LaTeX compiled successfully via local pdflatex`);
    } catch (err) {
      logger.warn('Local pdflatex compilation failed, trying API...', { error: (err as Error).message });
    }
  }

  // 2. Try YtoTech API
  if (!compiledSuccessfully) {
    logger.info('Compiling LaTeX to PDF via YtoTech API...');
    try {
      const response = await axios.post('https://latex.ytotech.com/builds/sync', {
        compiler: 'pdflatex',
        resources: [
          {
            main: true,
            content: cleanLatex
          }
        ]
      }, {
        responseType: 'arraybuffer',
        timeout: 15000
      });

      const finalPdfName = `Rishav_Sharma_Resume_${job.company.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      const finalPdfPath = path.join(outputDir, finalPdfName);
      fs.writeFileSync(finalPdfPath, Buffer.from(response.data));
      logger.info(`✅ LaTeX compiled successfully via API: ${finalPdfPath}`);
      compiledSuccessfully = true;
      
      // Clean up the temp .tex file
      if (fs.existsSync(texFilePath)) {
        fs.unlinkSync(texFilePath);
      }
    } catch (err) {
      logger.warn('YtoTech API compilation failed, trying Docker...', { error: (err as Error).message });
    }
  }

  // 3. Try Docker fallback
  if (!compiledSuccessfully) {
    logger.info('Compiling LaTeX to PDF via Docker...');
    try {
      const hostStoragePath = path.resolve(config.STORAGE_PATH);
      const compileCmd = `docker run --rm -v "${hostStoragePath}:/app/storage" jobhunt-worker:latest pdflatex -interaction=nonstopmode -output-directory="/app/storage/resumes" "/app/storage/temp_compile/${tempId}.tex"`;
      await execPromise(compileCmd);
      await execPromise(compileCmd);
      
      const compiledPdfName = `${tempId}.pdf`;
      const finalPdfName = `Rishav_Sharma_Resume_${job.company.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      const compiledPdfPath = path.join(outputDir, compiledPdfName);
      const finalPdfPath = path.join(outputDir, finalPdfName);

      if (fs.existsSync(compiledPdfPath)) {
        fs.renameSync(compiledPdfPath, finalPdfPath);
        logger.info(`✅ LaTeX compiled successfully via Docker: ${finalPdfPath}`);
        
        // Clean up auxiliary files
        const cleanUpExtensions = ['.aux', '.log', '.out', '.tex'];
        cleanUpExtensions.forEach((ext) => {
          const auxPath = path.join(outputDir, `${tempId}${ext}`);
          if (fs.existsSync(auxPath)) {
            fs.unlinkSync(auxPath);
          }
        });
        if (fs.existsSync(texFilePath)) {
          fs.unlinkSync(texFilePath);
        }
        compiledSuccessfully = true;
      }
    } catch (err) {
      logger.error('Docker compilation failed', { error: (err as Error).message });
    }
  }

  if (!compiledSuccessfully) {
    throw new Error('All LaTeX compilation methods (local, API, Docker) failed.');
  }

  const finalPdfName = `Rishav_Sharma_Resume_${job.company.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const relativePdfPath = `resumes/${finalPdfName}`;
  const pdfUrl = `${config.FRONTEND_URL.replace('3000', '4000')}/storage/${relativePdfPath}`;

  // Save tailored resume details to Application database
  await prisma.application.upsert({
    where: { jobId },
    create: {
      jobId,
      tailoredResumeLatex: cleanLatex,
      tailoredResumePdfPath: relativePdfPath,
      status: 'PENDING',
    },
    update: {
      tailoredResumeLatex: cleanLatex,
      tailoredResumePdfPath: relativePdfPath,
    },
  });

  return {
    pdfPath: relativePdfPath,
    pdfUrl,
    latex: cleanLatex,
  };
}
