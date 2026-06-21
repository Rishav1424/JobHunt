import { prisma } from '../../core/prisma';
import { proModel, flashModel, callWithRetry, parseGeminiJSON, generateEmbedding } from '../../core/gemini';
import { logger } from '../../core/logger';
import { retrieveRelevantContext, formatRetrievalContext } from './ragService';
import { lookupCachedAnswer, saveAnswerToBank } from './answerBankService';
import { compileTailoredResume } from './resumeCompiler';
import { redis } from '../../core/redis';

export interface AutofillField {
  id: string;      // DOM element identifier/selector
  name: string;    // input name attribute
  type: string;    // text, email, tel, textarea, file, etc.
  label: string;   // resolved label text
  required: boolean;
  options?: string[]; // for select/radio
  value?: string;
  confidence?: number;
  unresolved?: boolean;
}

export interface AutofillState {
  applicationId?: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  fields: AutofillField[];
  answers: Record<string, string>;
  unresolvedFields: AutofillField[];
  resumeTailored: boolean;
  tailoredResumeUrl?: string;
  status: 'parsing' | 'mapping' | 'waiting_for_user' | 'completed' | 'failed';
  errorMessage?: string;
  progressMessage?: string;
}

// In-memory store for active graph runs (live executors in this process)
const activeGraphRuns = new Map<string, AutofillGraphExecutor>();

// Redis key helper for persisted run state
const runStateKey = (key: string) => `autofill:run:${key}`;
const RUN_STATE_TTL_S = 7200; // 2 hours

export class AutofillGraphExecutor {
  public state: AutofillState;
  private socketId: string;
  private onStateChange: (state: AutofillState) => void;

  constructor(
    jobId: string,
    fields: AutofillField[],
    socketId: string,
    onStateChange: (state: AutofillState) => void
  ) {
    this.socketId = socketId;
    this.onStateChange = onStateChange;
    this.state = {
      jobId,
      jobTitle: '',
      companyName: '',
      jobDescription: '',
      fields,
      answers: {},
      unresolvedFields: [],
      resumeTailored: false,
      status: 'parsing',
    };
  }

  public static getRun(key: string): AutofillGraphExecutor | undefined {
    return activeGraphRuns.get(key);
  }

  /** Task 3: Retrieve just the persisted AutofillState from Redis (for reconnect scenarios). */
  public static async getRunState(key: string): Promise<AutofillState | null> {
    try {
      const raw = await redis.get(runStateKey(key));
      return raw ? (JSON.parse(raw) as AutofillState) : null;
    } catch {
      return null;
    }
  }

  public static registerRun(key: string, run: AutofillGraphExecutor) {
    activeGraphRuns.set(key, run);
    // Task 3: Persist state snapshot to Redis for cross-process durability
    redis.set(runStateKey(run.state.jobId), JSON.stringify(run.state), 'EX', RUN_STATE_TTL_S).catch(
      (err) => logger.warn(`autofillGraph: Failed to persist run state to Redis for jobId ${run.state.jobId}`, { error: err })
    );
  }

  public static removeRun(key: string) {
    const run = activeGraphRuns.get(key);
    if (run) {
      activeGraphRuns.delete(run.state.jobId);
      if (run.socketId) {
        activeGraphRuns.delete(run.socketId);
      }
      // Task 3: Remove Redis state on completion/failure
      redis.del(runStateKey(run.state.jobId)).catch(
        (err) => logger.warn(`autofillGraph: Failed to delete Redis run state for jobId ${run.state.jobId}`, { error: err })
      );
    } else {
      activeGraphRuns.delete(key);
      redis.del(runStateKey(key)).catch(() => {});
    }
  }

  public static removeSocketMapping(socketId: string) {
    activeGraphRuns.delete(socketId);
  }

  public updateSocket(socketId: string, onStateChange: (state: AutofillState) => void) {
    if (this.socketId && activeGraphRuns.get(this.socketId) === this) {
      activeGraphRuns.delete(this.socketId);
    }
    this.socketId = socketId;
    this.onStateChange = onStateChange;
    activeGraphRuns.set(socketId, this);
    activeGraphRuns.set(this.state.jobId, this);
  }

  private emitUpdate() {
    this.onStateChange({ ...this.state });
    // Task 3: Persist state snapshot to Redis on state changes
    redis.set(runStateKey(this.state.jobId), JSON.stringify(this.state), 'EX', RUN_STATE_TTL_S).catch(
      (err) => logger.warn(`autofillGraph: Failed to persist run state to Redis for jobId ${this.state.jobId}`, { error: err })
    );
  }

  /**
   * Helper to persist current form answers to the Application database session.
   */
  private async saveSessionAnswers() {
    try {
      if (!this.state.applicationId) {
        const app = await prisma.application.upsert({
          where: { jobId: this.state.jobId },
          create: {
            jobId: this.state.jobId,
            status: 'PENDING',
            formAnswers: this.state.answers,
          },
          update: {
            formAnswers: this.state.answers,
          },
        });
        this.state.applicationId = app.id;
      } else {
        await prisma.application.update({
          where: { id: this.state.applicationId },
          data: {
            formAnswers: this.state.answers,
          },
        });
      }
      logger.debug(`Session answers saved to DB for jobId: ${this.state.jobId}`);
    } catch (err) {
      logger.error('Failed to save session answers to database', { error: err });
    }
  }

  /**
   * Run the graph from the beginning or resume after HITL.
   */
  public async execute(userAnswers?: Record<string, string>): Promise<void> {
    try {
      if (userAnswers) {
        // We are resuming from Human-in-the-loop resolution
        logger.info(`Resuming autofill execution for socket: ${this.socketId}`);
        this.emitProgress('Resuming and merging your answers...');
        this.state.status = 'mapping';
        this.emitUpdate();

        // Get Application reference
        const app = await prisma.application.findUnique({ where: { jobId: this.state.jobId } });
        if (app) {
          this.state.applicationId = app.id;
        }

        // 1. Merge human resolved answers
        for (const [fieldId, val] of Object.entries(userAnswers)) {
          this.state.answers[fieldId] = val;
          // Find field and update its value
          const field = this.state.fields.find((f) => f.id === fieldId);
          if (field) {
            field.value = val;
            field.unresolved = false;
          }

          // Save ALL HITL-resolved answers to AnswerBank (user explicitly provided them)
          const targetField = this.state.fields.find((f) => f.id === fieldId);
          if (targetField && val.trim().length >= 2) {
            await saveAnswerToBank(targetField.label, val, this.state.companyName);
            // Also save with normalized label for better semantic matching
            const normalised = targetField.label.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
            if (normalised !== targetField.label.toLowerCase()) {
              await saveAnswerToBank(normalised, val, this.state.companyName).catch(() => {}); // best-effort
            }
          }
        }
        this.state.unresolvedFields = [];
        await this.saveSessionAnswers();
      } else {
        // Fresh run: Initialize job data
        logger.info(`Starting new autofill execution for jobId: ${this.state.jobId}`);
        this.emitProgress('Initializing job details and profile data...');
        const job = await prisma.job.findUnique({ where: { id: this.state.jobId } });
        if (!job) {
          throw new Error(`Target job not found: ${this.state.jobId}`);
        }
        this.state.jobTitle = job.title;
        this.state.companyName = job.company;
        this.state.jobDescription = job.description;

        this.state.status = 'mapping';
        this.emitUpdate();

        // Ensure Application record exists in DB
        let app = await prisma.application.findUnique({ where: { jobId: this.state.jobId } });
        if (!app) {
          app = await prisma.application.create({
            data: {
              jobId: this.state.jobId,
              status: 'PENDING',
              formAnswers: {},
            },
          });
        }
        this.state.applicationId = app.id;

        // Load existing formAnswers from DB into local state.answers
        const existingAnswers = (app.formAnswers as Record<string, string>) || {};
        for (const [fieldId, val] of Object.entries(existingAnswers)) {
          this.state.answers[fieldId] = val;
          // Pre-populate fields that match
          const field = this.state.fields.find((f) => f.id === fieldId);
          if (field) {
            field.value = val;
            field.confidence = 1.0;
          }
        }

        // Node 1: Fast match static contact info
        await this.matchStaticFields();
      }

      // Node 2: Process remaining custom/descriptive fields in batch
      await this.processCustomFields();

      // Node 3: Check if there are any gaps that require Human interrupt
      if (this.state.unresolvedFields.length > 0) {
        logger.info(`Autofill paused: ${this.state.unresolvedFields.length} unresolved fields requiring human-in-the-loop.`);
        this.state.status = 'waiting_for_user';
        this.emitUpdate();
        return; // Pause execution, wait for resolve socket call
      }

      // Node 4: Compile tailored resume PDF
      await this.tailorResumeNode();

      // Node 5: Wrap up
      this.state.status = 'completed';
      this.emitUpdate();
      AutofillGraphExecutor.removeRun(this.socketId);
      logger.info(`Autofill execution completed successfully for socket: ${this.socketId}`);
    } catch (error) {
      logger.error('Error in autofill graph execution', { error });
      this.state.status = 'failed';
      this.state.errorMessage = (error as Error).message;
      this.emitUpdate();
      AutofillGraphExecutor.removeRun(this.socketId);
    }
  }

  /**
   * Node 1: Match static details (contact details, links) using regex mapping.
   */
  private async matchStaticFields() {
    logger.info('Running Node: MatchStaticFields');
    this.emitProgress('Matching static fields (Name, Email, Socials)...');
    const profile = await prisma.userProfile.findFirst();
    if (!profile) {
      throw new Error('User profile not found. Seed user profile first.');
    }

    for (const field of this.state.fields) {
      if (field.value) continue; // Already has value

      const normLabel = field.label.toLowerCase();
      const normName = field.name.toLowerCase();

      const isName = normLabel.includes('name') || normName.includes('name');
      const isEmail = normLabel.includes('email') || normName.includes('email');
      const isPhone = normLabel.includes('phone') || normLabel.includes('tel') || normLabel.includes('mobile') || normName.includes('phone') || normName.includes('mobile');
      const isLinkedin = normLabel.includes('linkedin') || normName.includes('linkedin');
      const isGithub = normLabel.includes('github') || normName.includes('github');
      const isWebsite = normLabel.includes('portfolio') || normLabel.includes('website') || normName.includes('portfolio') || normName.includes('website');
      const isLocation = normLabel.includes('location') || normLabel.includes('city') || normLabel.includes('address') || normName.includes('location') || normName.includes('city');

      let val: string | null = null;
      if (isName) {
        if (normLabel.includes('first name') || normName.includes('first')) {
          val = profile.name.split(' ')[0];
        } else if (normLabel.includes('last name') || normName.includes('last')) {
          val = profile.name.split(' ').slice(1).join(' ') || profile.name;
        } else {
          val = profile.name;
        }
      } else if (isEmail) {
        val = profile.email;
      } else if (isPhone) {
        val = profile.phone;
      } else if (isLinkedin) {
        val = profile.linkedinUrl;
      } else if (isGithub) {
        val = profile.githubUrl;
      } else if (isWebsite) {
        val = profile.githubUrl; // default or custom portfolio link
      } else if (isLocation) {
        val = profile.location;
      }

      if (val) {
        this.state.answers[field.id] = val;
        field.value = val;
        field.confidence = 1.0;
        logger.debug(`Mapped static field: "${field.label}" -> "${val}"`);
      }
    }

    this.emitProgress('Static fields matched successfully.');
    await this.saveSessionAnswers();
  }

  /**
   * Node 2: Handle custom questions in batch parallel execution.
   * Uses pgvector for O(log n) retrieval instead of O(n) in-memory scans.
   */
  private async processCustomFields() {
    logger.info('Running Node: ProcessCustomFields');
    const profile = await prisma.userProfile.findFirst();
    if (!profile) return;

    // Filter fields that are still missing answers (excluding file upload/resumes)
    const customFields = this.state.fields.filter(
      (f) => !f.value && f.type !== 'file' && !f.label.toLowerCase().includes('resume') && !f.label.toLowerCase().includes('cv')
    );

    if (customFields.length === 0) {
      logger.info('No custom fields to fill.');
      return;
    }

    logger.info(`Processing ${customFields.length} custom fields in batch...`);
    this.emitProgress(`Checking AnswerBank cache for ${customFields.length} custom questions...`);

    // Fast exact match via indexed DB query — no findMany() needed
    for (const field of customFields) {
      let exactMatch = await prisma.answerBank.findFirst({
        where: {
          question: { equals: field.label, mode: 'insensitive' },
          company: this.state.companyName,
        },
      });
      if (!exactMatch) {
        exactMatch = await prisma.answerBank.findFirst({
          where: {
            question: { equals: field.label, mode: 'insensitive' },
            company: "",
          },
        });
      }
      if (exactMatch) {
        this.state.answers[field.id] = exactMatch.answer;
        field.value = exactMatch.answer;
        field.confidence = 0.99;
        logger.info(`🎯 Exact cache hit for field: "${field.label}" (company: ${exactMatch.company || 'general'})`);
      }
    }

    // Filter fields that are still missing answers
    const remainingFields = customFields.filter((f) => !f.value);
    if (remainingFields.length === 0) {
      logger.info('All custom fields resolved via local exact cache.');
      this.emitProgress('All custom fields resolved via AnswerBank.');
      await this.saveSessionAnswers();
      return;
    }

    // ── Task 13: Reuse pre-computed jdStructured & embedding ─────────────────
    // Retrieve RAG Context using pgvector (O(log n) HNSW index) — no findMany()
    this.emitProgress(`Retrieving relevant background context for ${remainingFields.length} questions...`);
    let RAGContext = 'No specific background context available.';
    let jobEmbeddingVector: number[] | null = null;

    try {
      const existingJob = await prisma.job.findUnique({
        where: { id: this.state.jobId },
        select: { description: true, jdStructured: true, embedding: true },
      });

      // Build a richer context signal from pre-computed jdStructured if available
      let jobContextSignal = `${this.state.jobTitle} at ${this.state.companyName}`;
      if (existingJob?.jdStructured) {
        const s = existingJob.jdStructured as any;
        if (s.mustHaveSkills?.length) {
          jobContextSignal += `\nRequired: ${(s.mustHaveSkills as string[]).join(', ')}`;
        }
        if (s.techStack?.length) {
          jobContextSignal += `\nStack: ${(s.techStack as string[]).join(', ')}`;
        }
      } else {
        jobContextSignal += `\n${this.state.jobDescription.slice(0, 500)}`;
      }

      // Reuse the job's stored embedding if available — skip API call
      if (existingJob?.embedding && existingJob.embedding.length > 0) {
        jobEmbeddingVector = existingJob.embedding;
        logger.info('Reusing pre-computed job embedding for RAG retrieval');
      } else {
        jobEmbeddingVector = await generateEmbedding(jobContextSignal.slice(0, 8000));
      }

      // Use pgvector for fast similarity retrieval of knowledge chunks
      const chunks = await retrieveRelevantContext(jobContextSignal, 6);
      RAGContext = formatRetrievalContext(chunks);
    } catch (ragErr) {
      logger.error('Failed to retrieve RAG context for batch custom fields', { error: ragErr });
    }

    // ── Task 2: AnswerBank semantic lookup via pgvector ───────────────────────
    // Use lookupCachedAnswer() which uses pgvector — no findMany() + in-memory cosine
    let formattedAnswerBank = 'No previously answered questions match this job context.';
    try {
      if (jobEmbeddingVector) {
        const vectorStr = `[${jobEmbeddingVector.join(',')}]`;
        const topAnswers = await prisma.$queryRaw<{ question: string; answer: string; company: string }[]>`
          SELECT question, answer, company
          FROM "AnswerBank"
          WHERE company = ${this.state.companyName} OR company = ''
          ORDER BY embedding_vec <=> cast(${vectorStr} as vector)
          LIMIT 15
        `;
        if (topAnswers.length > 0) {
          formattedAnswerBank = topAnswers
            .map((m) => `Q: "${m.question}"\nA: "${m.answer}"`)
            .join('\n\n');
        }
      }
    } catch (cacheErr) {
      logger.error('Failed to retrieve relevant AnswerBank context via pgvector', { error: cacheErr });
    }

    // 4. Batch Gemini Prompt
    logger.debug(`Generating batched AI answers for ${remainingFields.length} fields`);
    this.emitProgress(`Querying Gemini to synthesize answers for ${remainingFields.length} fields...`);
    const prompt = `
You are filling out a job application form on behalf of the applicant, Rishav Sharma.
Answer the following application questions based on the provided background context, previous Q&A history, and the target job description.

Applicant Personal Info:
- Name: ${profile.name}
- Email: ${profile.email}
- Phone: ${profile.phone}
- Skills: ${profile.skills.join(', ')}

Job Details:
- Title: ${this.state.jobTitle}
- Company: ${this.state.companyName}
- Job Description:
${this.state.jobDescription}

Previously Answered Q&As (Use these answers if the questions are semantically similar to the current questions):
${formattedAnswerBank}

Relevant Background Context (RAG):
${RAGContext}

List of Questions to Answer:
${remainingFields.map((f, idx) => `${idx + 1}. [Field ID: ${f.id}] Label: "${f.label}" ${f.options ? `(Options: ${f.options.join(', ')})` : ''}`).join('\n')}

Instructions:
1. Provide answers for each question in the first person (e.g., "I designed...", "My experience...").
2. Align the tone with a professional Software Engineer.
3. Be specific and leverage the background context. Avoid generic buzzwords.
4. Keep each answer concise and natural (usually 2-4 sentences or 100-150 words maximum unless it is a very long descriptive answer).
5. If the context or previous Q&As do not contain enough information to answer a question accurately, or if you are highly uncertain, set the answer for that Field ID to "UNRESOLVED_GAP".
6. Respond with a JSON object where the keys are the Field IDs and the values are the generated answers.

Respond with ONLY valid JSON:
{
  ${remainingFields.map((f) => `"${f.id}": "<answer or UNRESOLVED_GAP>"`).join(',\n  ')}
}
`;

    try {
      const rawText = await callWithRetry(async () => {
        const result = await flashModel.generateContent(prompt);
        return result.response.text().trim();
      }, 3, `fillFieldsBatch_${this.state.jobId}`);

      const answerMap = parseGeminiJSON<Record<string, string>>(rawText);

      this.emitProgress('Processing generated answers from Gemini...');
      // Parse and apply answers
      for (const field of remainingFields) {
        const answerText = answerMap[field.id]?.trim();
        
        if (!answerText || answerText === 'UNRESOLVED_GAP') {
          logger.warn(`Gemini identified gap or missing answer for field: "${field.label}"`);
          field.unresolved = true;
          this.state.unresolvedFields.push(field);
        } else {
          this.state.answers[field.id] = answerText;
          field.value = answerText;
          field.confidence = 0.85;

          // Save to global AnswerBank in the background (no await)
          saveAnswerToBank(field.label, answerText).catch((err) =>
            logger.error(`Failed to save cache in background for "${field.label}"`, { error: err })
          );
        }
      }
    } catch (err) {
      logger.error('Failed to process batch custom fields', { error: err });
      for (const field of remainingFields) {
        field.unresolved = true;
        this.state.unresolvedFields.push(field);
      }
    }

    this.emitProgress('Custom fields processed.');
    await this.saveSessionAnswers();
  }

  /**
   * Node 4: Generate a tailored PDF resume.
   */
  private async tailorResumeNode() {
    logger.info('Running Node: TailorResume');

    // Check if there is a resume file field
    const hasResumeField = this.state.fields.some(
      (f) => f.type === 'file' || f.label.toLowerCase().includes('resume') || f.label.toLowerCase().includes('cv')
    );

    if (!hasResumeField) {
      logger.info('No resume file field detected on this form page. Skipping compilation.');
      return;
    }

    if (this.state.resumeTailored) {
      logger.info('Resume already tailored. Skipping compilation.');
      this.emitProgress('Using cached tailored resume PDF.');
      return;
    }

    try {
      this.emitProgress('Compiling tailored LaTeX resume...');
      const result = await compileTailoredResume(this.state.jobId);
      
      this.state.tailoredResumeUrl = result.pdfUrl;
      this.state.resumeTailored = true;

      // Map the tailored URL to the file field for download
      const resumeField = this.state.fields.find(
        (f) => f.type === 'file' || f.label.toLowerCase().includes('resume') || f.label.toLowerCase().includes('cv')
      );
      if (resumeField) {
        resumeField.value = result.pdfUrl;
      }

      this.emitProgress('Tailored resume compiled successfully.');
      logger.info(`✅ Tailored resume available at: ${result.pdfUrl}`);
    } catch (err) {
      logger.error('Failed to compile tailored resume in graph execution', { error: err });
      // Don't fail the whole autofill; fallback to base resume download
      const baseResumeUrl = `http://localhost:4000/storage/resumes/Rishav_Sharma_Resume_Base.pdf`;
      this.state.tailoredResumeUrl = baseResumeUrl;
      this.state.resumeTailored = false;
      this.emitProgress('Tailoring failed, falling back to base resume.');
    }
  }

  private emitProgress(message: string) {
    logger.info(`Progress: ${message}`);
    this.state.progressMessage = message;
    this.emitUpdate();
  }
}

function extractAnswerText(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed === 'object' && parsed !== null) {
      // Find the first string value in the object
      const values = Object.values(parsed);
      const stringValue = values.find(val => typeof val === 'string');
      if (stringValue !== undefined) {
        return stringValue;
      }
    }
  } catch {
    // If it's not valid JSON, treat it as raw text
  }
  return rawText.trim();
}
