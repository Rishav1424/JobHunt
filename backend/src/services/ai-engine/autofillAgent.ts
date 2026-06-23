import { prisma } from '../../core/prisma';
import { proModel, flashModel, callWithRetry, parseGeminiJSON, generateEmbedding } from '../../core/gemini';
import { logger } from '../../core/logger';
import { compileTailoredResume } from './resumeCompiler';
import { redis } from '../../core/redis';
import { formatProfileJsonToText } from './scorer';
import { analyzeFormFields, FieldAnalysis } from './formAnalyzer';
import { lookupCachedAnswer, saveAnswerToBank } from './answerBankService';
import { config } from '../../core/config';

export type AutofillStateName =
  | 'IDLE'
  | 'PAGE_DETECT'
  | 'AUTH_DETECT'
  | 'AUTH_FILL'
  | 'AUTH_SUBMIT'
  | 'OTP_WAIT'
  | 'MAGIC_LINK_WAIT'
  | 'FIELDS_EXTRACT'
  | 'FIELDS_ANALYZE'
  | 'CONTEXT_BUILD'
  | 'ANSWERS_GENERATE'
  | 'RESUME_COMPILE'
  | 'INJECT_PLAN'
  | 'INJECT_EXECUTE'
  | 'INJECT_VALIDATE'
  | 'INJECT_RETRY'
  | 'HITL_REQUIRED'
  | 'PAGE_OBSERVE'
  | 'NEXT_STEP'
  | 'COMPLETED'
  | 'FAILED';

export interface AutofillField {
  id: string;
  name: string;
  type: string;
  label: string;
  required: boolean;
  options?: string[];
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
  status: AutofillStateName | 'parsing' | 'mapping' | 'waiting_for_user' | 'completed' | 'failed';
  errorMessage?: string;
  progressMessage?: string;
  lastPageUrl?: string;
  analyzedFields?: FieldAnalysis[];
}

const activeRuns = new Map<string, AutofillAgentExecutor>();
const runStateKey = (key: string) => `autofill:run:${key}`;
const RUN_STATE_TTL_S = 7200; // 2 hours

export class AutofillAgentExecutor {
  public state: AutofillState;
  private socketId: string;
  private onStateChange: (state: AutofillState) => void;
  private sendCommand?: (event: string, payload: any) => void;
  private responseResolvers = new Map<string, (data: any) => void>();
  private analyzedFields: FieldAnalysis[] = [];
  private failedInjectionFields: string[] = [];
  private isLooping = false;

  constructor(
    jobId: string,
    fields: AutofillField[],
    socketId: string,
    onStateChange: (state: AutofillState) => void,
    sendCommand?: (event: string, payload: any) => void
  ) {
    this.socketId = socketId;
    this.onStateChange = onStateChange;
    this.sendCommand = sendCommand;
    this.state = {
      jobId,
      jobTitle: '',
      companyName: '',
      jobDescription: '',
      fields,
      answers: {},
      unresolvedFields: [],
      resumeTailored: false,
      status: 'IDLE',
    };
  }

  public static getRun(key: string): AutofillAgentExecutor | undefined {
    return activeRuns.get(key);
  }

  public static async getRunState(key: string): Promise<AutofillState | null> {
    try {
      const raw = await redis.get(runStateKey(key));
      return raw ? (JSON.parse(raw) as AutofillState) : null;
    } catch {
      return null;
    }
  }

  public static registerRun(key: string, run: AutofillAgentExecutor) {
    activeRuns.set(key, run);
    redis.set(runStateKey(run.state.jobId), JSON.stringify(run.state), 'EX', RUN_STATE_TTL_S).catch(
      (err) => logger.warn(`autofillAgent: Failed to persist run state to Redis for jobId ${run.state.jobId}`, { error: err })
    );
  }

  public static removeRun(key: string) {
    const run = activeRuns.get(key);
    if (run) {
      activeRuns.delete(run.state.jobId);
      if (run.socketId) {
        activeRuns.delete(run.socketId);
      }
      redis.del(runStateKey(run.state.jobId)).catch(
        (err) => logger.warn(`autofillAgent: Failed to delete Redis run state for jobId ${run.state.jobId}`, { error: err })
      );
    } else {
      activeRuns.delete(key);
      redis.del(runStateKey(key)).catch(() => {});
    }
  }

  public static removeSocketMapping(socketId: string) {
    activeRuns.delete(socketId);
  }

  public updateSocket(
    socketId: string,
    onStateChange: (state: AutofillState) => void,
    sendCommand?: (event: string, payload: any) => void
  ) {
    if (this.socketId && activeRuns.get(this.socketId) === this) {
      activeRuns.delete(this.socketId);
    }
    this.socketId = socketId;
    this.onStateChange = onStateChange;
    this.sendCommand = sendCommand;
    activeRuns.set(socketId, this);
    activeRuns.set(this.state.jobId, this);
  }

  private emitUpdate() {
    this.state.analyzedFields = this.analyzedFields;
    this.onStateChange({ ...this.state });
    redis.set(runStateKey(this.state.jobId), JSON.stringify(this.state), 'EX', RUN_STATE_TTL_S).catch(
      (err) => logger.warn(`autofillAgent: Failed to persist run state to Redis for jobId ${this.state.jobId}`, { error: err })
    );
  }

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

  public handleResponse(event: string, data: any) {
    const resolver = this.responseResolvers.get(event);
    if (resolver) {
      this.responseResolvers.delete(event);
      resolver(data);
    }
  }

  private async requestFromFrontend(event: string, emitData?: any, timeoutMs = 25000): Promise<any> {
    return new Promise((resolve, reject) => {
      const responseEvent = `${event}:response`;
      const timeout = setTimeout(() => {
        this.responseResolvers.delete(responseEvent);
        reject(new Error(`Timeout waiting for ${responseEvent} from Chrome extension.`));
      }, timeoutMs);

      this.responseResolvers.set(responseEvent, (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      if (this.sendCommand) {
        this.sendCommand(event, emitData);
      } else {
        clearTimeout(timeout);
        reject(new Error('No active socket connection/emitter configured to send command to popup.'));
      }
    });
  }

  public async execute(userAnswers?: Record<string, string>): Promise<void> {
    try {
      if (this.state.analyzedFields) {
        this.analyzedFields = this.state.analyzedFields;
      }
      if (userAnswers) {
        logger.info(`Resuming autofill execution for socket: ${this.socketId}`);
        // Store preview approval in Redis
        await redis.set(`autofill:approved:${this.state.jobId}`, 'true', 'EX', 3600);
        
        // Merge resolved human inputs
        for (const [fieldId, val] of Object.entries(userAnswers)) {
          this.state.answers[fieldId] = val;
          const field = this.state.fields.find((f) => f.id === fieldId);
          if (field) {
            field.value = val;
            field.unresolved = false;
          }
          const targetField = this.state.fields.find((f) => f.id === fieldId) || this.analyzedFields.find((f) => f.id === fieldId);
          if (targetField && val.trim().length >= 2) {
            await saveAnswerToBank(targetField.label, val, this.state.companyName);
            const normalised = targetField.label.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
            if (normalised !== targetField.label.toLowerCase()) {
              await saveAnswerToBank(normalised, val, this.state.companyName).catch(() => {});
            }
          }
        }
        this.state.unresolvedFields = [];
        await this.saveSessionAnswers();
        
        // Transition back to execute after user input
        this.state.status = 'INJECT_EXECUTE';
      } else {
        logger.info(`Starting new autofill execution for jobId: ${this.state.jobId}`);
        // Clear previous approval
        await redis.del(`autofill:approved:${this.state.jobId}`);
        const job = await prisma.job.findUnique({ where: { id: this.state.jobId } });
        if (!job) {
          throw new Error(`Target job not found: ${this.state.jobId}`);
        }
        this.state.jobTitle = job.title;
        this.state.companyName = job.company;
        this.state.jobDescription = job.description;

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

        const existingAnswers = (app.formAnswers as Record<string, string>) || {};
        for (const [fieldId, val] of Object.entries(existingAnswers)) {
          this.state.answers[fieldId] = val;
          const field = this.state.fields.find((f) => f.id === fieldId);
          if (field) {
            field.value = val;
            field.confidence = 1.0;
          }
        }

        this.state.status = 'PAGE_DETECT';
      }

      await this.runStateMachine();
    } catch (error: any) {
      logger.error('Error in autofill state machine loop', { error });
      this.state.status = 'FAILED';
      this.state.errorMessage = (error as Error).message;
      this.emitUpdate();
      AutofillAgentExecutor.removeRun(this.socketId);
    }
  }

  private async runStateMachine() {
    if (this.isLooping) return;
    this.isLooping = true;

    let loopCount = 0;
    const maxLoops = 25;

    try {
      while (
        this.state.status !== 'COMPLETED' &&
        this.state.status !== 'FAILED' &&
        this.state.status !== 'HITL_REQUIRED' &&
        loopCount < maxLoops
      ) {
        loopCount++;
        logger.info(`[State Machine] Transition Loop #${loopCount}: Current state is ${this.state.status}`);

        if (this.state.status === 'PAGE_DETECT') {
          this.state.progressMessage = 'Sensing page context and type...';
          this.emitUpdate();

          // Retry page classification up to 3 times to handle redirects/slow page loads
          let pageInfo: any = null;
          let detectAttempts = 0;
          const maxDetectAttempts = 3;

          while (detectAttempts < maxDetectAttempts) {
            detectAttempts++;
            try {
              pageInfo = await this.requestFromFrontend('page:classify');
              this.state.lastPageUrl = pageInfo.url;
              logger.info(`[PAGE_DETECT] Attempt ${detectAttempts}: pageType=${pageInfo.pageType}, URL=${pageInfo.url}`);

              // If page has meaningful content, stop retrying
              if (pageInfo.pageType !== 'unknown') break;

              // Unknown page — could be a redirect or loading page; wait and retry
              if (detectAttempts < maxDetectAttempts) {
                logger.info(`[PAGE_DETECT] Page type unknown, waiting 3s before retry ${detectAttempts + 1}/${maxDetectAttempts}...`);
                this.state.progressMessage = `Page loading or redirecting — retrying detection (${detectAttempts}/${maxDetectAttempts})...`;
                this.emitUpdate();
                await new Promise((r) => setTimeout(r, 3000));
              }
            } catch (err: any) {
              logger.warn(`[PAGE_DETECT] Attempt ${detectAttempts} failed: ${err.message}`);
              if (detectAttempts >= maxDetectAttempts) {
                pageInfo = null;
              } else {
                await new Promise((r) => setTimeout(r, 2000));
              }
            }
          }

          if (!pageInfo) {
            logger.warn(`[PAGE_DETECT] All detection attempts failed, falling back to field extraction`);
            this.state.status = 'FIELDS_EXTRACT';
          } else if (pageInfo.pageType === 'login' || pageInfo.pageType === 'signup') {
            this.state.status = 'AUTH_DETECT';
          } else if (pageInfo.pageType === 'otp') {
            this.state.status = 'OTP_WAIT';
          } else if (pageInfo.pageType === 'magic_link_wait') {
            this.state.status = 'MAGIC_LINK_WAIT';
          } else if (['application_form', 'multi_step_form'].includes(pageInfo.pageType)) {
            this.state.status = 'FIELDS_EXTRACT';
          } else if (pageInfo.pageType === 'confirmation') {
            this.state.status = 'COMPLETED';
          } else {
            // Still unknown after retries — treat as application form and try extracting fields
            logger.warn(`[PAGE_DETECT] Page type remained '${pageInfo.pageType}' after ${maxDetectAttempts} attempts. Attempting field extraction anyway.`);
            this.state.status = 'FIELDS_EXTRACT';
          }
        }


        else if (this.state.status === 'AUTH_DETECT') {
          this.state.progressMessage = 'Auth screen detected. Relaying check to extension...';
          this.emitUpdate();
          try {
            // Request extension to check if it has credentials stored locally
            const hostname = new URL(this.state.lastPageUrl || 'http://localhost').hostname;
            const credCheck = await this.requestFromFrontend('auth:check-credentials', { hostname });
            if (credCheck && credCheck.hasCreds) {
              this.state.status = 'AUTH_FILL';
            } else {
              // Pause and trigger credentials prompt in extension UI
              if (this.sendCommand) {
                this.sendCommand('login_needed', { hostname });
              }
              this.state.status = 'HITL_REQUIRED';
            }
          } catch (err) {
            logger.error('[AUTH_DETECT] Credential check failed', err);
            this.state.status = 'FIELDS_EXTRACT';
          }
        }

        else if (this.state.status === 'AUTH_FILL') {
          this.state.progressMessage = 'Injecting authentication credentials...';
          this.emitUpdate();
          try {
            const fillRes = await this.requestFromFrontend('auth:fill-credentials');
            if (fillRes && fillRes.success) {
              this.state.status = 'AUTH_SUBMIT';
            } else {
              throw new Error(fillRes?.error || 'Failed to fill credentials');
            }
          } catch (err: any) {
            logger.error('[AUTH_FILL] Fill failed', err);
            this.state.status = 'FAILED';
            this.state.errorMessage = err.message;
          }
        }

        else if (this.state.status === 'AUTH_SUBMIT') {
          this.state.progressMessage = 'Submitting credentials and waiting for reload...';
          this.emitUpdate();
          try {
            await this.requestFromFrontend('dom:click', { selector: 'button[type="submit"], input[type="submit"], #login, .login-btn' });
            await new Promise((r) => setTimeout(r, 3000));
            this.state.status = 'PAGE_DETECT';
          } catch (err) {
            logger.warn('[AUTH_SUBMIT] Submit click failed, checking new page state anyway', err);
            this.state.status = 'PAGE_DETECT';
          }
        }

        else if (this.state.status === 'OTP_WAIT') {
          this.state.progressMessage = 'OTP page detected. Fetching code from Gmail...';
          this.emitUpdate();
          try {
            if (this.sendCommand) {
              this.sendCommand('otp_checking', {});
            }
            const otpRes = await this.requestFromFrontend('otp:retrieve', {}, 40000);
            if (otpRes && otpRes.otp) {
              this.state.progressMessage = `OTP acquired: ${otpRes.otp}. Injecting...`;
              this.emitUpdate();
              await this.requestFromFrontend('field:inject', {
                fieldId: 'input[maxlength="6"], input[id*="code"], input[name*="code"]',
                value: otpRes.otp,
                strategies: ['PHONE_MASKED', 'NATIVE_SETTER']
              });
              await this.requestFromFrontend('dom:click', { selector: 'button[type="submit"], #submit, .verify-btn' });
              await new Promise((r) => setTimeout(r, 3000));
              this.state.status = 'PAGE_DETECT';
            } else {
              this.state.status = 'HITL_REQUIRED';
            }
          } catch (err) {
            logger.error('[OTP_WAIT] OTP retrieval failed', err);
            this.state.status = 'HITL_REQUIRED';
          }
        }

        else if (this.state.status === 'MAGIC_LINK_WAIT') {
          this.state.progressMessage = 'Magic link authentication page detected. Checking Gmail...';
          this.emitUpdate();
          try {
            const linkRes = await this.requestFromFrontend('magic_link:retrieve', {}, 40000);
            if (linkRes && linkRes.url) {
              this.state.progressMessage = 'Verification link found. Directing browser tab...';
              this.emitUpdate();
              await this.requestFromFrontend('dom:navigate', { url: linkRes.url });
              await new Promise((r) => setTimeout(r, 4000));
              this.state.status = 'PAGE_DETECT';
            } else {
              this.state.status = 'HITL_REQUIRED';
            }
          } catch (err) {
            logger.error('[MAGIC_LINK_WAIT] Magic link check failed', err);
            this.state.status = 'HITL_REQUIRED';
          }
        }

        else if (this.state.status === 'FIELDS_EXTRACT') {
          this.state.progressMessage = 'Scanning DOM for input elements...';
          this.emitUpdate();
          try {
            const res = await this.requestFromFrontend('fields:extract');
            if (res && res.success) {
              this.state.fields = res.fields;
              this.state.status = 'FIELDS_ANALYZE';
            } else {
              throw new Error(res?.error || 'Failed to extract form fields');
            }
          } catch (err: any) {
            logger.error('[FIELDS_EXTRACT] Failed to extract', err);
            this.state.status = 'FAILED';
            this.state.errorMessage = err.message;
          }
        }

        else if (this.state.status === 'FIELDS_ANALYZE') {
          this.state.progressMessage = 'AI classifying field intents...';
          this.emitUpdate();
          try {
            this.analyzedFields = await analyzeFormFields(this.state.fields);

            // Guard: if no fields found, the page may still be loading/redirecting
            if (this.analyzedFields.length === 0) {
              logger.warn('[FIELDS_ANALYZE] Zero fields found — page may still be loading. Re-detecting...');
              this.state.progressMessage = 'No form fields found, re-detecting page...';
              await new Promise((r) => setTimeout(r, 2500));
              this.state.status = 'PAGE_DETECT';
            } else {
              this.state.status = 'CONTEXT_BUILD';
            }
          } catch (err: any) {
            logger.error('[FIELDS_ANALYZE] Failed analysis', err);
            this.state.status = 'FAILED';
            this.state.errorMessage = err.message;
          }
        }

        else if (this.state.status === 'CONTEXT_BUILD') {
          this.state.progressMessage = 'Loading candidate context...';
          this.emitUpdate();
          try {
            if (!this.state.jobTitle) {
              const job = await prisma.job.findUnique({ where: { id: this.state.jobId } });
              if (!job) throw new Error(`Target job not found: ${this.state.jobId}`);
              this.state.jobTitle = job.title;
              this.state.companyName = job.company;
              this.state.jobDescription = job.description;
            }
            this.state.status = 'ANSWERS_GENERATE';
          } catch (err: any) {
            logger.error('[CONTEXT_BUILD] Failed building context', err);
            this.state.status = 'FAILED';
            this.state.errorMessage = err.message;
          }
        }

        else if (this.state.status === 'ANSWERS_GENERATE') {
          this.state.progressMessage = 'Generating and retrieving tailored responses...';
          this.emitUpdate();
          try {
            await this.generateAnswersForFields();

            const hasResumeField = this.analyzedFields.some(
              (f) => f.intent === 'resume' || f.type === 'file' || f.label.toLowerCase().includes('resume') || f.label.toLowerCase().includes('cv')
            );
            if (hasResumeField && !this.state.resumeTailored) {
              this.state.status = 'RESUME_COMPILE';
            } else {
              this.state.status = 'INJECT_PLAN';
            }
          } catch (err: any) {
            logger.error('[ANSWERS_GENERATE] Answers generation failed', err);
            this.state.status = 'FAILED';
            this.state.errorMessage = err.message;
          }
        }

        else if (this.state.status === 'RESUME_COMPILE') {
          this.state.progressMessage = 'Compiling resume LaTeX PDF for this job...';
          this.emitUpdate();
          try {
            const result = await compileTailoredResume(this.state.jobId);
            this.state.tailoredResumeUrl = result.pdfUrl;
            this.state.resumeTailored = true;
            this.state.status = 'INJECT_PLAN';
          } catch (err) {
            logger.error('[RESUME_COMPILE] Failed compiling resume, using base resume', err);
            const baseUrl = config.FRONTEND_URL.replace('3000', '4000');
            this.state.tailoredResumeUrl = `${baseUrl}/storage/resumes/Rishav_Sharma_Resume_Base.pdf`;
            this.state.resumeTailored = false;
            this.state.status = 'INJECT_PLAN';
          }
        }

        else if (this.state.status === 'INJECT_PLAN') {
          this.state.progressMessage = 'Validating answers before injection...';
          this.emitUpdate();
          const unresolved: AutofillField[] = [];
          for (const field of this.analyzedFields) {
            const val = this.state.answers[field.id];
            // Exclude resume and cover_letter file fields from unresolved check
            const isFileField = field.intent === 'resume' || (field.intent === 'cover_letter' && field.type === 'file');
            if (!val && field.required && !isFileField) {
              unresolved.push(field);
            }
          }

          const hasApproved = await redis.get(`autofill:approved:${this.state.jobId}`);

          if (unresolved.length > 0) {
            this.state.unresolvedFields = unresolved;
            this.state.status = 'HITL_REQUIRED';
          } else if (!hasApproved) {
            // Pause once to let the user review/preview the answers
            this.state.status = 'HITL_REQUIRED';
            this.state.unresolvedFields = []; // Empty list indicates we are in preview mode!
          } else {
            this.state.status = 'INJECT_EXECUTE';
          }
        }

        else if (this.state.status === 'INJECT_EXECUTE') {
          this.state.progressMessage = 'Executing value injections...';
          this.emitUpdate();
          try {
            await this.executeInjections();
            this.state.status = 'INJECT_VALIDATE';
          } catch (err: any) {
            logger.error('[INJECT_EXECUTE] Injection failed', err);
            this.state.status = 'FAILED';
            this.state.errorMessage = err.message;
          }
        }

        else if (this.state.status === 'INJECT_VALIDATE') {
          this.state.progressMessage = 'Checking values inside DOM fields...';
          this.emitUpdate();
          try {
            const validationResults = await this.validateInjections();
            // validationResults entries are { value: string, empty: boolean } — check 'empty', not 'success'
            const failed = Object.entries(validationResults)
              .filter(([_, res]: any) => res.empty === true)
              .map(([fieldId]) => fieldId);

            if (failed.length > 0) {
              this.failedInjectionFields = failed;
              this.state.status = 'INJECT_RETRY';
            } else {
              this.state.status = 'PAGE_OBSERVE';
            }
          } catch (err: any) {
            logger.warn('[INJECT_VALIDATE] Validation error, proceeding anyway', err);
            this.state.status = 'PAGE_OBSERVE';
          }
        }

        else if (this.state.status === 'INJECT_RETRY') {
          this.state.progressMessage = `Retrying ${this.failedInjectionFields.length} failed injections with fallbacks...`;
          this.emitUpdate();
          try {
            await this.retryFailedInjections();
            this.state.status = 'PAGE_OBSERVE';
          } catch (err) {
            logger.warn('[INJECT_RETRY] Failed retry phase, proceeding', err);
            this.state.status = 'PAGE_OBSERVE';
          }
        }

        else if (this.state.status === 'PAGE_OBSERVE') {
          this.state.progressMessage = 'Analyzing submission state...';
          this.emitUpdate();
          try {
            const obs = await this.requestFromFrontend('page:observe');
            if (obs && obs.confirmationDetected) {
              this.state.status = 'COMPLETED';
            } else if (obs && obs.errorDetected) {
              logger.warn(`[PAGE_OBSERVE] Validation error detected on form: ${obs.errorText}`);
              this.state.status = 'HITL_REQUIRED';
              this.state.progressMessage = `Form has errors: ${obs.errorText}`;
              break;
            } else {
              const res = await this.requestFromFrontend('fields:extract');
              if (res && res.isMultiStep && res.fields.length > 0) {
                this.state.status = 'NEXT_STEP';
              } else {
                this.state.status = 'COMPLETED';
              }
            }
          } catch (err) {
            logger.warn('[PAGE_OBSERVE] Error, finishing up anyway', err);
            this.state.status = 'COMPLETED';
          }
        }

        else if (this.state.status === 'NEXT_STEP') {
          this.state.progressMessage = 'Navigating to next wizard step...';
          this.emitUpdate();
          try {
            await this.requestFromFrontend('dom:click', { selector: 'button[class*="next" i], button[id*="next" i], input[value*="Next" i]' });
            await new Promise((r) => setTimeout(r, 2500));
            this.state.status = 'PAGE_DETECT';
          } catch (err) {
            logger.warn('[NEXT_STEP] Navigation failed, re-detecting', err);
            this.state.status = 'PAGE_DETECT';
          }
        }

        if (loopCount >= maxLoops) {
          throw new Error('Maximum agent state machine iteration loops exceeded.');
        }
      }

      if (this.state.status === 'COMPLETED') {
        logger.info(`Autofill completed successfully for socket: ${this.socketId}`);
        this.state.progressMessage = 'Form successfully autofilled!';
        this.emitUpdate();
        AutofillAgentExecutor.removeRun(this.socketId);
      } else if (this.state.status === 'HITL_REQUIRED' || this.state.status === 'FAILED') {
        this.emitUpdate();
      }
    } finally {
      this.isLooping = false;
    }
  }

  private async generateAnswersForFields() {
    const profile = await prisma.userProfile.findFirst();
    if (!profile) throw new Error('User profile database not found. Seed first.');

    const profileSummary = formatProfileJsonToText(profile);
    const unanswered = this.analyzedFields.filter((f) => !this.state.answers[f.id] && f.intent !== 'resume');

    for (const field of unanswered) {
      const label = field.label;
      const intent = field.intent;

      // 1. Static Facts Lookup
      const staticVal = this.lookupStaticFact(intent, profile);
      if (staticVal) {
        this.state.answers[field.id] = staticVal;
        const stateField = this.state.fields.find(f => f.id === field.id);
        if (stateField) stateField.value = staticVal;
        continue;
      }

      // 2. Exact/Semantic Cache Lookup
      const cached = await lookupCachedAnswer(label, this.state.companyName);
      if (cached) {
        this.state.answers[field.id] = cached;
        const stateField = this.state.fields.find(f => f.id === field.id);
        if (stateField) stateField.value = cached;
        continue;
      }

      // 3. Question-Specific RAG Similarity query
      this.state.progressMessage = `Retrieving RAG details for: "${label.slice(0, 30)}..."`;
      this.emitUpdate();

      let categories: string[] = [];
      if (intent === 'behavioral_question') categories = ['behavioral', 'experience', 'project'];
      else if (intent === 'project_question') categories = ['project', 'experience', 'technical_strength'];
      else if (intent === 'motivation_question') categories = ['career_narrative', 'company_motivation'];
      else if (intent === 'technical_question') categories = ['experience', 'technical_strength', 'project'];

      let RAGContext = '';
      try {
        const queryVector = await generateEmbedding(label);
        const vectorStr = `[${queryVector.join(',')}]`;
        let chunks: any[];

        if (categories.length > 0) {
          chunks = await prisma.$queryRaw<any[]>`
            SELECT id, category, title, content,
                   (1 - (embedding_vec <=> cast(${vectorStr} as vector))) AS similarity
            FROM "KnowledgeChunk"
            WHERE category = ANY(${categories})
            ORDER BY embedding_vec <=> cast(${vectorStr} as vector)
            LIMIT 5
          `;
        } else {
          chunks = await prisma.$queryRaw<any[]>`
            SELECT id, category, title, content,
                   (1 - (embedding_vec <=> cast(${vectorStr} as vector))) AS similarity
            FROM "KnowledgeChunk"
            ORDER BY embedding_vec <=> cast(${vectorStr} as vector)
            LIMIT 5
          `;
        }
        RAGContext = chunks
          .map((c, i) => `[Context Chunk #${i + 1}: ${c.title || c.category.toUpperCase()}]\n${c.content}`)
          .join('\n\n');
      } catch (err) {
        logger.error(`Question-specific RAG failed for "${label}"`, err);
      }

      // 4. Gemini Answer Generation
      const prompt = `
You are completing a job application form on behalf of the applicant, Rishav Sharma.
Generate a tailored answer for the following question based on the candidate's background and RAG context.

Question: "${label}"
Intent/Category: ${intent}
${field.options ? `Options: ${field.options.join(', ')}` : ''}

Job Details:
- Title: ${this.state.jobTitle}
- Company: ${this.state.companyName}
- Description: ${this.state.jobDescription.slice(0, 1000)}

Candidate Summary:
${profileSummary}

Relevant Background Context (RAG):
${RAGContext || 'No specific background context available.'}

Instructions:
1. Provide the answer in the first person ("I designed...", "My experience...").
2. Align tone with a professional Software Engineer.
3. Be specific, use context. Keep the answer natural and concise (usually 2-4 sentences or 100-150 words max).
4. If options are specified, choose the single most appropriate option from the list exactly.
5. If the context does not contain enough information to answer the question, or if you are highly uncertain, respond with ONLY the word "UNRESOLVED_GAP".

Respond with ONLY the generated answer or "UNRESOLVED_GAP":
`;

      try {
        const text = await callWithRetry(async () => {
          // Use flashModel for cost-efficiency — answer generation is a simple task
          const result = await flashModel.generateContent(prompt);
          return result.response.text().trim();
        }, 3, `genAnswer_${field.id}`);

        if (text && text !== 'UNRESOLVED_GAP') {
          this.state.answers[field.id] = text;
          const stateField = this.state.fields.find(f => f.id === field.id);
          if (stateField) stateField.value = text;
          saveAnswerToBank(label, text, this.state.companyName).catch(() => {});
        } else {
          logger.warn(`Gemini identified gap for question: "${label}"`);
        }
      } catch (err) {
        logger.error(`Failed to generate answer via Gemini for field ${field.id}`, err);
      }
    }
  }

  private lookupStaticFact(intent: string, profile: any): string | null {
    const json = profile.profileJson as any;
    const facts = json?.facts || {};

    if (intent === 'first_name') return profile.name?.split(' ')[0] || null;
    if (intent === 'last_name') return profile.name?.split(' ').slice(1).join(' ') || null;
    if (intent === 'full_name') return profile.name || null;
    if (intent === 'email') return profile.email || null;
    if (intent === 'phone') return profile.phone || null;
    if (intent === 'linkedin') return profile.linkedinUrl || null;
    if (intent === 'github') return profile.githubUrl || null;
    // website: prefer dedicated websiteUrl, fall back to github
    if (intent === 'website') return profile.websiteUrl || profile.portfolioUrl || profile.githubUrl || null;
    if (intent === 'university') return facts.college || null;
    if (intent === 'graduation_year') return facts.graduationDate || null;
    if (intent === 'gpa') return facts.cgpa || null;
    if (intent === 'degree') return facts.degree || null;
    if (intent === 'notice_period') return facts.noticePeriod || '0 days';
    // Common facts that should not require AI generation:
    if (intent === 'yoe') return facts.yearsOfExperience?.toString() || null;
    if (intent === 'salary_expectation') return facts.expectedSalary?.toString() || null;
    if (intent === 'work_authorization') return facts.workAuthorization || 'Yes';
    if (intent === 'sponsorship') return facts.requiresSponsorship || 'No';
    if (intent === 'relocation') return facts.willingToRelocate || 'Yes';

    return null;
  }

  private async executeInjections() {
    const baseUrl = config.FRONTEND_URL.replace('3000', '4000');
    const fallbackResumeUrl = `${baseUrl}/storage/resumes/Rishav_Sharma_Resume_Base.pdf`;

    for (const field of this.analyzedFields) {
      const val = this.state.answers[field.id];
      const isFileField = field.intent === 'resume' || (field.intent === 'cover_letter' && field.type === 'file');

      if (!val && !isFileField) continue;

      if (isFileField) {
        const fileUrl = this.state.tailoredResumeUrl || fallbackResumeUrl;
        this.state.progressMessage = `Uploading ${field.intent === 'cover_letter' ? 'cover letter' : 'resume'} PDF to form...`;
        this.emitUpdate();
        try {
          await this.requestFromFrontend('field:upload', {
            fieldId: field.id,
            fileUrl,
            filename: `Rishav_Sharma_Resume_${this.state.companyName.replace(/\s+/g, '_')}.pdf`
          });
        } catch (err) {
          logger.warn(`File upload failed for field ${field.id}`, err);
        }
      } else {
        this.state.progressMessage = `Injecting field: ${field.label}...`;
        this.emitUpdate();
        try {
          await this.requestFromFrontend('field:inject', {
            fieldId: field.id,
            value: val,
            strategies: [field.injectionStrategy, ...field.injectionFallbacks]
          });
        } catch (err) {
          logger.warn(`Injection failed for field ${field.id}`, err);
        }
      }
    }
  }

  private async validateInjections(): Promise<Record<string, { success: boolean; actualValue: string }>> {
    const fieldIds = this.analyzedFields.filter((f) => f.intent !== 'resume').map((f) => f.id);
    if (fieldIds.length === 0) return {};

    try {
      const validation = await this.requestFromFrontend('fields:validate', { fieldIds });
      return validation.results || {};
    } catch (err) {
      logger.error('Failed to validate fields', err);
      return {};
    }
  }

  private async retryFailedInjections() {
    for (const id of this.failedInjectionFields) {
      const field = this.analyzedFields.find((f) => f.id === id);
      const val = this.state.answers[id];
      if (!field || !val) continue;

      // Use field-type-appropriate retry strategies
      const retryStrategies = field.type === 'select' || !!field.options
        ? ['CUSTOM_DROPDOWN', 'SELECT_NATIVE', 'KEYBOARD_SIM']
        : field.type === 'radio'
        ? ['RADIO_CLICK', 'KEYBOARD_SIM']
        : field.type === 'checkbox'
        ? ['CHECKBOX_CLICK', 'KEYBOARD_SIM']
        : ['KEYBOARD_SIM', 'PHONE_MASKED', 'NATIVE_SETTER', 'DIRECT_VALUE'];

      logger.info(`Retrying injection for field: ${field.label} with strategies: ${retryStrategies.join(', ')}`);
      try {
        await this.requestFromFrontend('field:inject', {
          fieldId: field.id,
          value: val,
          strategies: retryStrategies
        });
      } catch (err) {
        logger.warn(`Retry failed for field ${field.id}`, err);
      }
    }
  }
}

// Export AutofillGraphExecutor as an alias to AutofillAgentExecutor for backward compatibility
export const AutofillGraphExecutor = AutofillAgentExecutor;
