import { prisma } from '../core/prisma';
import { AutofillGraphExecutor, AutofillField } from '../services/ai-engine/autofillGraph';
import { logger } from '../core/logger';

async function runTest() {
  logger.info('🚀 Starting Autofill Graph Integration Test...');

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
  const executor = new AutofillGraphExecutor(
    job.id,
    mockFields,
    socketId,
    async (state) => {
      logger.info(`🔄 Graph State Update: [Status: ${state.status}]`);
      if (state.status === 'waiting_for_user') {
        logger.warn(`⚠️ Graph paused for Human-in-the-Loop! Unresolved fields:`);
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
      } else if (state.status === 'completed') {
        logger.info('✅ Integration Test Completed Successfully!');
        logger.info('--- FINAL ANSWERS MAP ---');
        console.log(JSON.stringify(state.answers, null, 2));
        logger.info(`Tailored Resume PDF URL: ${state.tailoredResumeUrl}`);
        process.exit(0);
      } else if (state.status === 'failed') {
        logger.error(`❌ Graph execution failed: ${state.errorMessage}`);
        process.exit(1);
      }
    }
  );

  // 4. Register and run the executor
  AutofillGraphExecutor.registerRun(socketId, executor);
  await executor.execute();
}

runTest().catch((err) => {
  logger.error('❌ Integration test crashed', { error: err });
  process.exit(1);
});
