import { prisma } from '../core/prisma';
import { AutofillAgentExecutor, AutofillField } from '../services/ai-engine/autofillAgent';
import { logger } from '../core/logger';

async function runTest() {
  logger.info('🚀 Starting Autofill Agent Integration Test...');

  // 1. Fetch a job to simulate applying for (take the first scored/approved job in the database)
  const job = await prisma.job.findFirst({
    where: {
      status: { in: ['SCORED', 'APPROVED'] },
    },
  });

  if (!job) {
    logger.error('❌ No jobs found in database to run autofill test. Please run scrapers first.');
    process.exit(1);
  }

  logger.info(`Applying for Job: "${job.title}" at "${job.company}"`);

  // 2. Define mock form fields scraped from the page
  const mockFields: AutofillField[] = [
    { id: 'field-name', name: 'name', type: 'text', label: 'Full Name', required: true },
    { id: 'field-email', name: 'email', type: 'email', label: 'Email Address', required: true },
    { id: 'field-phone', name: 'phone', type: 'tel', label: 'Phone Number', required: true },
    { id: 'field-linkedin', name: 'linkedin', type: 'text', label: 'LinkedIn Profile', required: true },
    { id: 'field-github', name: 'github', type: 'text', label: 'GitHub URL', required: false },
    // A custom/descriptive question that should trigger RAG context lookup
    {
      id: 'field-project',
      name: 'complex_project',
      type: 'textarea',
      label: 'Describe a complex technical project you built, the challenges you faced, and the results.',
      required: true,
    },
    // Another question that might hit the AnswerBank or Gemini
    {
      id: 'field-why-role',
      name: 'why_role',
      type: 'textarea',
      label: `Why do you want to join ${job.company} as a ${job.title}?`,
      required: true,
    },
    // A question with missing information in candidate profile, likely to trigger Human-in-the-Loop
    {
      id: 'field-notice-period',
      name: 'notice_period',
      type: 'text',
      label: 'What is your current notice period in days?',
      required: true,
    },
    // File field for resume upload
    { id: 'field-resume', name: 'resume', type: 'file', label: 'Upload your Resume/CV', required: true },
  ];

  // 3. Initialize the executor
  const socketId = `mock-socket-${Date.now()}`;
  const executor = new AutofillAgentExecutor(
    job.id,
    mockFields,
    socketId,
    async (state) => {
      logger.info(`🔄 Agent State Update: [Status: ${state.status}]`);
      if (state.status === 'HITL_REQUIRED') {
        logger.warn(`⚠️ Agent paused for Human-in-the-Loop! Unresolved fields:`);
        state.unresolvedFields.forEach((f) => {
          logger.warn(`  - [${f.id}] "${f.label}"`);
        });

        // Simulate Human resolving the notice period question after 2 seconds
        logger.info('⏳ Simulating human inputs in 2 seconds...');
        setTimeout(async () => {
          const resolutions: Record<string, string> = {};
          state.unresolvedFields.forEach((f) => {
            if (f.id === 'field-notice-period') {
              resolutions[f.id] = '0 days (Immediate Joiner)';
            } else {
              resolutions[f.id] = 'Mock answer for unresolved field';
            }
          });
          
          logger.info('✍️ Submitting human resolutions...');
          await executor.execute(resolutions);
        }, 2000);
      } else if (state.status === 'COMPLETED') {
        logger.info('✅ Integration Test Completed Successfully!');
        logger.info('--- FINAL ANSWERS MAP ---');
        console.log(JSON.stringify(state.answers, null, 2));
        logger.info(`Tailored Resume PDF URL: ${state.tailoredResumeUrl}`);
        process.exit(0);
      } else if (state.status === 'FAILED') {
        logger.error(`❌ Agent execution failed: ${state.errorMessage}`);
        process.exit(1);
      }
    },
    (event, payload) => {
      logger.info(`[Mock Popup] Received event from backend: "${event}"`);
      // Simulate extension script responding back after a delay
      setTimeout(() => {
        if (event === 'page:classify') {
          executor.handleResponse('page:classify:response', {
            pageType: 'application_form',
            url: 'https://jobs.lever.co/mock/sde',
          });
        } else if (event === 'fields:extract') {
          executor.handleResponse('fields:extract:response', {
            success: true,
            fields: mockFields,
            isMultiStep: false,
          });
        } else if (event === 'field:inject') {
          executor.handleResponse('field:inject:response', {
            success: true,
            fieldId: payload.fieldId,
            strategy: payload.strategies[0],
            validated: true,
            actualValue: payload.value,
          });
        } else if (event === 'fields:validate') {
          const results: Record<string, any> = {};
          payload.fieldIds.forEach((id: string) => {
            const field = mockFields.find((f) => f.id === id);
            results[id] = { success: true, actualValue: field?.value || 'Mocked' };
          });
          executor.handleResponse('fields:validate:response', { results });
        } else if (event === 'page:observe') {
          executor.handleResponse('page:observe:response', {
            confirmationDetected: false,
            errorDetected: false,
          });
        } else if (event === 'field:upload') {
          executor.handleResponse('field:upload:response', { success: true });
        }
      }, 500);
    }
  );

  // 4. Register and run the executor
  AutofillAgentExecutor.registerRun(socketId, executor);
  await executor.execute();
}

runTest().catch((err) => {
  logger.error('❌ Integration test crashed', { error: err });
  process.exit(1);
});
