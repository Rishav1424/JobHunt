# JobHunt — Technical Suggestions
### Structural Fixes · API Correctness · Engine Optimization · Smarter Agent Behaviour

---

## I. Critical Structural Fixes

### 1. Route Ordering Bug — `GET /jobs/queues/status` is Unreachable

In `backend/src/api/jobs.ts`, `GET /:id` is registered before `GET /queues/status`. Express matches `GET /queues/status` as `GET /:id` with `id = 'queues'`, looks for a job, gets 404. The Queues page never loads.

**Fix — move both queue routes above `GET /:id`:**
```typescript
// jobs.ts — correct order
jobsRouter.get('/stats', ...);
jobsRouter.get('/health', ...);
jobsRouter.get('/detect', ...);
jobsRouter.get('/queues/status', ...);   // ← MOVE UP
jobsRouter.post('/queues/:name/drain', ...); // ← MOVE UP
jobsRouter.get('/:id', ...);            // dynamic route always last
```

**Wider fix:** Add an ESLint rule or a comment convention that flags dynamic route definitions. Any `get('/:id', ...)` should always be the last GET handler in a router file.

---

### 2. `autofillGraph.ts` O(n) Full Table Scans

Despite `ragService.ts` and `answerBankService.ts` being fixed, `autofillGraph.ts` still bypasses pgvector entirely with two separate `findMany()` calls:

```typescript
// CURRENT — broken
const chunks = await prisma.knowledgeChunk.findMany();          // full table
const allCachedAnswers = await prisma.answerBank.findMany();    // full table x2
// ... in-memory cosine similarity loops
```

**Fix — use the existing pgvector service functions:**
```typescript
// For KnowledgeChunk retrieval — use retrieveRelevantContext() from ragService.ts
const jobContextQuery = `${this.state.jobTitle} at ${this.state.companyName} ${this.state.jobDescription.slice(0, 500)}`;
const chunks = await retrieveRelevantContext(jobContextQuery, 6);
const RAGContext = formatRetrievalContext(chunks);

// For AnswerBank exact match — single indexed query, not findMany
const exactMatch = await prisma.answerBank.findFirst({
  where: { question: field.label },
});

// For AnswerBank semantic match — use lookupCachedAnswer() from answerBankService.ts
const cached = await lookupCachedAnswer(field.label);
```

This drops the autofill hot path from O(n) per field to O(log n) per session.

---

### 3. `activeGraphRuns` In-Memory Map — Sessions Lost on Restart

The autofill graph sessions are stored in a process-level `Map`:
```typescript
const activeGraphRuns = new Map<string, AutofillGraphExecutor>();
```

If the backend process restarts mid-autofill (crash, redeploy), the session is gone. The extension's HITL resolve call then hits `getRun(socketId)` → `undefined` → `autofill:error`. The user has to re-start the entire form fill.

**Fix — serialise session state to Redis keyed by socket ID:**
```typescript
// On each state transition, save serialisable state to Redis
const SESSION_TTL_SECONDS = 30 * 60; // 30 min

async function persistSession(socketId: string, state: AutofillState): Promise<void> {
  await redis.set(
    `autofill:session:${socketId}`,
    JSON.stringify({
      jobId: state.jobId,
      answers: state.answers,
      unresolvedFields: state.unresolvedFields,
      applicationId: state.applicationId,
      status: state.status,
    }),
    'EX',
    SESSION_TTL_SECONDS
  );
}

async function restoreSession(socketId: string): Promise<Partial<AutofillState> | null> {
  const raw = await redis.get(`autofill:session:${socketId}`);
  return raw ? JSON.parse(raw) : null;
}
```

On `autofill:hitl-resolve`, before creating a new `AutofillGraphExecutor`, try restoring from Redis first.

---

### 4. Gemini Rate Limiter is Process-Local — Not Distributed

`backend/src/core/gemini.ts` uses an in-process token bucket:
```typescript
let lastCallTime = 0;
let callQueue = Promise.resolve();
```

If you ever run two worker processes (e.g., `worker.ts` + `index.ts` both calling Gemini), each process has its own rate limiter, effectively doubling throughput past the 15 RPM ceiling and triggering 429s that burn retry budget.

**Fix — Redis-backed distributed rate limiter:**
```typescript
// In gemini.ts — replace in-process limiter
async function rateLimit(): Promise<void> {
  const key = 'gemini:last_call_ms';
  const MIN_INTERVAL = 4000;

  while (true) {
    const lastRaw = await redis.get(key);
    const last = lastRaw ? parseInt(lastRaw) : 0;
    const elapsed = Date.now() - last;

    if (elapsed >= MIN_INTERVAL) {
      // Claim this slot atomically
      const set = await redis.set(key, String(Date.now()), 'XX', 'PX', MIN_INTERVAL * 2);
      // if set is null, another process just claimed it; loop
      if (set !== null) break;
    }

    await new Promise(r => setTimeout(r, MIN_INTERVAL - elapsed + 50));
  }
}
```

Alternatively, use the `rate-limiter-flexible` library with a Redis backend — it's purpose-built for this and handles edge cases.

---

### 5. No Deduplication Guard on Scoring Queue

If a manual rescore (`POST /jobs/:id/score`) fires while the scheduler is mid-run, the same jobId gets two entries in BullMQ. The job gets scored twice, consuming two Gemini API slots and potentially writing two conflicting results.

**Fix — use BullMQ's `jobId` deduplication option:**
```typescript
// In queues.ts — triggerJobScore
await scoringQueue.add(
  'score-job',
  { jobIds: [jobId] },
  {
    priority: 1,
    jobId: `score-${jobId}`,  // BullMQ deduplicates by jobId — second add is a no-op
  }
);

// In createScrapingWorker — batch enqueue
const scoringJobs = chunks.map((chunkIds) => ({
  name: 'score-job-batch',
  data: { jobIds: chunkIds },
  opts: {
    priority: 1,
    jobId: `batch-${chunkIds.join('-')}`,  // deterministic ID = dedup
  },
}));
```

---

### 6. `profileJson` Not Auto-Generated from Resume — Structured Scoring Silently Degrades

`formatProfileJsonToText()` in `scorer.ts` uses structured `profileJson` when available, but falls back to LaTeX stripping otherwise. Users who run `db:seed` (the primary setup path) get a `UserProfile` with no `profileJson`. The fallback path produces low-density text that undermines scoring quality — silently, with no log warning.

**Fix — generate a baseline `profileJson` during seed or on first scoring run:**
```typescript
// In scorer.ts — ensureProfileEmbedding() or a new ensureProfileJson()
async function ensureProfileJson(profile: UserProfile): Promise<void> {
  if (profile.profileJson) return;
  
  const prompt = `
Parse this LaTeX resume and return ONLY a JSON object with these keys:
{
  "facts": { "name", "email", "phone", "location", "graduationDate", "college", "degree", "cgpa", "currentRole", "noticePeriod" },
  "skills": [{ "name", "level": "strong|comfortable|familiar", "context" }],
  "preferences": { "rolePreferences": { "primary", "avoid" }, "domainInterests", "dealBreakers" }
}

Resume: ${profile.baseResumeLatex}`;

  const result = await callWithRetry(() => flashModel.generateContent(prompt), 3, 'generateProfileJson');
  const profileJson = parseGeminiJSON(result.response.text());
  
  await prisma.userProfile.update({
    where: { id: profile.id },
    data: { profileJson },
  });
}
```

Call this at the start of `scoreJobsBatch()` if `profile.profileJson` is null.

---

## II. API Layer Fixes

### 7. Blacklist Company Push Creates Duplicates

`PATCH /jobs/:id/status` with `BLACKLISTED` does:
```typescript
await prisma.settings.updateMany({
  data: { blacklistedCompanies: { push: job.company } },
});
```

`{ push }` appends unconditionally. Blacklisting the same company twice fills the list with duplicates. The same bug exists in `bulk-status`.

**Fix — check before push:**
```typescript
const settings = await prisma.settings.findFirst();
if (!settings?.blacklistedCompanies.includes(job.company)) {
  await prisma.settings.update({
    where: { id: settings!.id },
    data: { blacklistedCompanies: { push: job.company } },
  });
}
```

Or add a unique constraint at the Postgres level using a check constraint via raw migration.

---

### 8. `/settings/simulate-score` Has No Job Record — `scoreJob` Side-Effects Fire on a Ghost

`POST /settings/simulate-score` creates a transient job object and calls `scoreJob()`:
```typescript
const tempJob = { id: 'simulation', title, company, description, ... };
const result = await scoreJob(tempJob as any);
```

But `scoreJob()` → `scoreJobsBatch()` does:
```typescript
const job = await prisma.job.findUnique({ where: { id: jobId } });
```
`id = 'simulation'` returns `null`. The function pushes `{ jobId, analysis: null }` and returns early. The endpoint then returns `null` to the client, causing a 200 with no useful data.

**Fix — add a `dryRun` flag to `scoreJobsBatch` or create a dedicated `scoreJDText()` function:**
```typescript
// scorer.ts — new function, no DB writes
export async function scoreJDText(
  title: string,
  company: string,
  description: string
): Promise<FitAnalysis | null> {
  const [settings, profile] = await Promise.all([
    prisma.settings.findFirst(),
    prisma.userProfile.findFirst(),
  ]);
  // ... build prompt, call Gemini, return analysis
  // NO prisma.job.update() calls
}
```

---

### 9. `scraper/:name/reset` Calls `recordSuccess()` — Wrong Semantics

`POST /api/jobs/scrapers/:name/reset` calls `recordSuccess(name)` to reset the circuit breaker. `recordSuccess()` is the correct mechanism but it was designed to be called after a successful scrape run. Calling it as a manual admin action resets failures to 0, which is correct, but the log message says "recovery confirmed" implying a scraper ran — which it didn't.

This is a semantic / logging issue but also means there's no `resetCircuit()` primitive that could be cleaner to call. Minor, but add a dedicated function:
```typescript
// scraperHealth.ts
export async function manualReset(name: string): Promise<void> {
  await Promise.all([
    redis.set(key(name, 'state'), 'CLOSED', 'EX', KEY_TTL_S),
    redis.set(key(name, 'failures'), '0', 'EX', KEY_TTL_S),
    redis.del(key(name, 'openedAt')),
  ]);
  logger.info(`Circuit breaker [${name}]: Manually reset to CLOSED by admin`);
}
```

---

## III. Scoring Engine Optimisations

### 10. Feedback Calibration Fetched Per Scoring Call — Cache It

`getFeedbackCalibration()` does two Redis `lrange` calls every time `scoreJobsBatch()` runs. With concurrency=1 and sequential scoring, this is fine now. But it's still unnecessary overhead since feedback signals change infrequently (only when user approves/skips).

**Fix — cache calibration text in Redis with a 5-minute TTL:**
```typescript
// feedback.ts
const CALIBRATION_CACHE_KEY = 'feedback:calibration:text';
const CALIBRATION_CACHE_TTL = 300; // 5 min

export async function getFeedbackCalibration(): Promise<string> {
  const cached = await redis.get(CALIBRATION_CACHE_KEY);
  if (cached) return cached;

  const text = await buildCalibrationText(); // existing logic
  if (text) await redis.set(CALIBRATION_CACHE_KEY, text, 'EX', CALIBRATION_CACHE_TTL);
  return text;
}

// Invalidate cache on recordApproval / recordSkip
export async function recordApproval(...) {
  await redis.del(CALIBRATION_CACHE_KEY);
  // ... existing logic
}
```

---

### 11. `getAllScraperHealth()` Makes 3 Redis Calls Per Scraper — Use `mget`

With 8 scrapers, `getAllScraperHealth()` makes 24 serial Redis calls. Use `mget`:
```typescript
export async function getAllScraperHealth(): Promise<Record<string, ScraperHealth>> {
  const { ALL_SCRAPERS } = require('../services/scrapers/index');
  const names = Object.keys(ALL_SCRAPERS);

  // Build all keys in one pass
  const allKeys = names.flatMap(n => [
    key(n, 'state'),
    key(n, 'failures'),
    key(n, 'openedAt'),
  ]);

  const values = await redis.mget(...allKeys);  // 1 round trip instead of 24

  const result: Record<string, ScraperHealth> = {};
  names.forEach((name, i) => {
    const offset = i * 3;
    result[name] = {
      state: (values[offset] as CircuitState) || 'CLOSED',
      failures: parseInt(values[offset + 1] || '0', 10),
      openedAt: values[offset + 2] ? parseInt(values[offset + 2]!, 10) : undefined,
    };
  });
  return result;
}
```

---

### 12. KnowledgeChunk Embeddings Generated Serially in Seed

`seed.ts` generates embeddings for each chunk sequentially inside a for-loop. With 15 RPM, 15 chunks take 60 seconds. Gemini's embedding endpoint has higher limits than the chat endpoint.

**Fix — batch with controlled concurrency (5 at a time):**
```typescript
// seed.ts — parallel embedding with concurrency limit
async function batchEmbedChunks(chunks: ParsedChunk[], concurrency = 5) {
  const results: { chunk: ParsedChunk; embedding: number[] }[] = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const embeddings = await Promise.all(batch.map(c => generateEmbedding(c.content)));
    batch.forEach((c, j) => results.push({ chunk: c, embedding: embeddings[j] }));
  }
  return results;
}
```

Reduces seed time from ~60s to ~15s for a typical resume.

---

### 13. `jdStructured` Already Computed — Not Reused in Autofill

The scoring pass extracts and saves `jdStructured` (`requiredYoe`, `mustHaveSkills`, `techStack`) for every job. The autofill graph then re-embeds the full job description from scratch to retrieve RAG context. This wastes one embedding API call per autofill session.

**Fix — use `jdStructured` as structured context anchor in `processCustomFields()`:**
```typescript
const job = await prisma.job.findUnique({
  where: { id: this.state.jobId },
  select: { description: true, jdStructured: true, embedding: true },
});

// Use pre-computed structured data if available
let jobContextSignal = `${this.state.jobTitle} at ${this.state.companyName}`;
if (job?.jdStructured) {
  const s = job.jdStructured as any;
  jobContextSignal += `\nRequired: ${(s.mustHaveSkills || []).join(', ')}`;
  jobContextSignal += `\nStack: ${(s.techStack || []).join(', ')}`;
} else {
  jobContextSignal += `\n${this.state.jobDescription.slice(0, 500)}`;
}

// If job already has an embedding saved, reuse it directly
let jobEmbeddingVector: number[];
if (job?.embedding && job.embedding.length > 0) {
  jobEmbeddingVector = job.embedding; // already computed during scoring
} else {
  jobEmbeddingVector = await generateEmbedding(jobContextSignal);
}
```

---

### 14. Feedback Loop is Informational — Not Adaptive

Approval/skip signals are stored in Redis and injected into the scoring prompt as examples. This tells Gemini "user liked X" but the actual `dimensionWeights` in Settings never change. The calibration is soft guidance, not structural adaptation.

**Fix — periodic weight recalibration job:**

After every 10th approval/skip, trigger a BullMQ job that:
1. Fetches the last 30 feedback signals
2. Computes which dimension scores most strongly correlate with approval vs skip
3. Suggests updated weights
4. Updates `settings.dimensionWeights` automatically

```typescript
// feedback.ts — after recording approval/skip
const count = await redis.incr('feedback:total_count');
if (count % 10 === 0) {
  await recalibrationQueue.add('recalibrate-weights', {}, { jobId: 'recalibrate-singleton' });
}

// New recalibration worker
async function recalibrateWeights() {
  const [approved, skipped] = await Promise.all([
    redis.lrange('feedback:approved', 0, 29),
    redis.lrange('feedback:skipped', 0, 29),
  ]);

  const approvedSignals = approved.map(s => JSON.parse(s) as FeedbackSignal);
  const skippedSignals = skipped.map(s => JSON.parse(s) as FeedbackSignal);

  if (approvedSignals.length < 5) return; // not enough data

  // Compute average dimension scores for approved vs skipped
  const avgDim = (signals: FeedbackSignal[], dim: keyof DimensionScores) =>
    signals.filter(s => s.dimensions).reduce((acc, s) => acc + (s.dimensions![dim] || 0), 0) / signals.length;

  const approvedAvgs = {
    techStack: avgDim(approvedSignals, 'techStack'),
    seniorityFit: avgDim(approvedSignals, 'seniorityFit'),
    domainFit: avgDim(approvedSignals, 'domainFit'),
    compensationFit: avgDim(approvedSignals, 'compensationFit'),
    companyTier: avgDim(approvedSignals, 'companyTier'),
  };
  // Dimensions with higher approved-vs-skipped delta deserve higher weight
  // ... normalise and update settings.dimensionWeights
}
```

---

## IV. Scraping Pipeline

### 15. Naukri and YCombinator Have No Detail Page Fetch

Both scrapers produce incomplete descriptions:
- Naukri falls back to `${title} at ${company}. Experience: ${expStr}` — almost no job content
- YCombinator uses Algolia `snippet` field (~200 chars)

Both `InstaHyre` and `WellFound` already use `fetchJobDetails()`. Apply the same pattern:

```typescript
// naukri.ts — inside normalization loop, after extracting url
let description = job.jobDescription || '';
if (!description || description.length < 400) {
  try {
    const details = await fetchJobDetails(url);
    if (details?.description && details.description.length > description.length) {
      description = details.description;
    }
  } catch { /* use what we have */ }
}

// ycombinator.ts — same addition after extracting jobUrl
```

This is the highest-ROI scraping fix: no LLM cost, no architectural change, dramatically better data quality for two scrapers.

---

### 16. Description Quality Gate — Don't Score Garbage

Even after detail fetch, some descriptions are too short to produce meaningful scores. Currently a 50-char description goes straight to Gemini scoring — a waste of API quota and the score will be noise.

**Fix — add a quality check in `persistListings()` and flag for enrichment:**
```typescript
function descriptionQualityScore(text: string): number {
  if (!text) return 0;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 200) return 0;
  if (cleaned.length < 500) return 0.5;
  // Check for substantive content markers
  const hasTechTerms = /\b(api|backend|java|python|node|spring|react|database|system|microservice)\b/i.test(cleaned);
  return hasTechTerms ? 1.0 : 0.7;
}

// In persistListings()
const quality = descriptionQualityScore(listing.description);
if (quality === 0) {
  // Still save the job but don't queue for immediate scoring
  // Queue for enrichment instead
  await enrichmentQueue.add('enrich-description', { jobId: created.id, url: listing.url });
  continue; // skip scoring queue
}
```

The enrichment worker re-fetches the job page using Playwright `fetchJobDetails()`, then re-queues for scoring only if description improves.

---

### 17. Deduplication Misses Same Job Across Sources

Current dedup hash: `SHA256(normalised_company + normalised_title)`. The same job posted on both LinkedIn and Naukri with slightly different titles ("SDE II" vs "Software Development Engineer II") creates two records, gets scored twice, burns 2× API quota.

**Fix — post-scoring semantic deduplication using job embeddings:**
After a job is scored (and has an embedding), check for similar jobs from the same company within the last 7 days:
```typescript
// In scorer.ts — after saving the scored job
const potentialDuplicates = await prisma.$queryRaw<{id: string}[]>`
  SELECT id FROM "Job"
  WHERE company = ${job.company}
    AND id != ${jobId}
    AND status = 'SCORED'
    AND "scrapedAt" > NOW() - INTERVAL '7 days'
    AND embedding_vec IS NOT NULL
    AND 1 - (embedding_vec <=> ${vectorStr}::vector) > 0.95
  LIMIT 3
`;

if (potentialDuplicates.length > 0) {
  logger.info(`Job ${jobId} appears to be a duplicate of ${potentialDuplicates[0].id} — marking`);
  await prisma.job.update({ where: { id: jobId }, data: { status: 'SKIPPED', fitScore: -2 } });
  // fitScore -2 = "duplicate" sentinel
}
```

---

## V. Autofill Agent Architecture

### 18. URL Parameter Trigger — Analysis and Recommended Approach

**Your proposal:** Append a `?jh_jobid=xxx` param to the apply URL in the dashboard, extension detects it and auto-starts.

**This is architecturally sound.** It's the cleanest low-coupling mechanism between dashboard and extension. No Chrome messaging API needed, no extension ID hardcoded in the frontend.

**Implementation:**
```typescript
// frontend — job detail page or job card
const handleApply = (job: Job) => {
  const applyUrl = new URL(job.applyUrl || job.url);
  applyUrl.searchParams.set('__jh', job.id);     // short, unlikely to collide
  window.open(applyUrl.toString(), '_blank');
};
```

```typescript
// extension/src/content.ts — on page load, before anything else
(function detectJobHuntTrigger() {
  const params = new URLSearchParams(window.location.search);
  const pendingJobId = params.get('__jh');
  
  if (pendingJobId) {
    // 1. Clean URL immediately so param doesn't appear in form submissions
    params.delete('__jh');
    const clean = window.location.pathname + (params.toString() ? '?' + params : '');
    history.replaceState({}, '', clean);

    // 2. Persist to sessionStorage so it survives same-tab redirects
    sessionStorage.setItem('__jh_jobid', pendingJobId);
    sessionStorage.setItem('__jh_ts', String(Date.now()));
  }
})();
```

```typescript
// extension/src/background.ts — open sidebar when tab finishes loading with pending context
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  
  chrome.tabs.sendMessage(tabId, { action: 'check_jh_pending' }, (response) => {
    if (chrome.runtime.lastError || !response?.jobId) return;
    // Auto-open sidebar for this tab
    chrome.sidePanel.open({ tabId });
  });
});
```

---

### 19. Multi-Hop Redirect Problem — Propagating Context Through Redirects

**The scenario:** Dashboard opens `https://company.com/careers/job-123` (company site). User sees an "Apply via Greenhouse" button that opens `https://boards.greenhouse.io/company/jobs/456`. The `__jh` param was on the first URL, but the form is on the second.

**The problem with URL params alone:** If the first URL doesn't accept unknown params (some ATS reject unknown query strings), or if the redirect is a POST redirect, the param gets lost.

**Recommended: Dual-layer approach**

**Layer 1 — `sessionStorage` (same-tab navigation):**
`sessionStorage` persists through same-tab navigations within the same origin. When the company site redirects (same tab) to the ATS, the `__jh_jobid` in `sessionStorage` survives.

**Layer 2 — Content script click interception (cross-origin new tab):**
```typescript
// content.ts — intercept outbound "Apply" clicks on intermediate pages
const pendingJobId = sessionStorage.getItem('__jh_jobid');
const pendingTs = parseInt(sessionStorage.getItem('__jh_ts') || '0');
const isRecent = Date.now() - pendingTs < 10 * 60 * 1000; // 10 min window

if (pendingJobId && isRecent) {
  document.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement;
    if (!link) return;
    
    const isApplyLink = /apply|application|submit|jobs\./i.test(link.href) ||
                        /apply|start application/i.test(link.textContent || '');
    
    if (isApplyLink && link.target === '_blank') {
      e.preventDefault();
      const dest = new URL(link.href);
      dest.searchParams.set('__jh', pendingJobId);
      window.open(dest.toString(), '_blank');
    }
  }, true); // capture phase so we catch it before ATS JS handlers
}
```

**Layer 3 — `chrome.storage.session` (cross-tab, cross-origin):**
```typescript
// background.ts — persist context across origins
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  
  const { pendingAutofill } = await chrome.storage.session.get('pendingAutofill');
  if (!pendingAutofill || Date.now() > pendingAutofill.expiresAt) return;
  
  // If navigating to any known ATS, associate this tab with the pending job
  if (isKnownATSHost(new URL(details.url).hostname)) {
    await chrome.storage.session.set({
      [`autofill_tab_${details.tabId}`]: pendingAutofill.jobId,
    });
  }
});
```

Content script checks `chrome.storage.session.get(`autofill_tab_${currentTabId}`)` as final fallback.

**Priority order:** URL param → sessionStorage → chrome.storage.session

---

### 20. Universal Form Coverage — Manifest and Platform Detection

Current manifest only covers Lever + Greenhouse. Change to:
```json
"content_scripts": [{
  "js": ["src/content.ts"],
  "matches": ["<all_urls>"],
  "run_at": "document_idle"
}],
"host_permissions": ["<all_urls>", "http://localhost:4000/*"]
```

Add a platform detection layer that determines how to scrape forms on each ATS:
```typescript
const ATS_PLATFORM_CONFIGS = {
  'lever.co':          { formSelector: '#application-form', fileInputAttr: 'name="resume"' },
  'greenhouse.io':     { formSelector: '#application_form', fileInputAttr: 'id="resume"' },
  'ashbyhq.com':       { formSelector: '[data-testid="application-form"]', fileInputAttr: 'type="file"' },
  'workday.com':       { formSelector: '[data-automation-id="formSection"]', waitForNavigation: true },
  'smartrecruiters.com': { formSelector: '.application-form', ajaxForm: true },
  'myworkdayjobs.com': { formSelector: '[data-automation-id="formSection"]', waitForNavigation: true },
};

function getPlatformConfig() {
  const host = window.location.hostname;
  return Object.entries(ATS_PLATFORM_CONFIGS).find(([key]) => host.includes(key))?.[1] ?? null;
}
```

For Workday specifically (which uses heavy JS rendering), add a `waitForElement` pattern in `scrapeForm()`:
```typescript
// content.ts — wait for lazy-rendered fields
async function waitForFormReady(maxWaitMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const hasInputs = document.querySelectorAll('input:not([type=hidden]), textarea').length > 0;
    if (hasInputs) return;
    await new Promise(r => setTimeout(r, 200));
  }
}
```

---

### 21. Login/Signup Flow Handling

Add a page type detector that runs on every load when a pending autofill exists:

```typescript
type PageType = 'login' | 'signup' | 'otp' | 'application_form' | 'intermediate' | 'confirmation';

function classifyPage(): PageType {
  const hasPassword = !!document.querySelector('input[type="password"]');
  const hasFileUpload = !!document.querySelector('input[type="file"]');
  const bodyText = document.body.innerText.toLowerCase();

  // OTP pages
  if (/verification code|otp|one.time|check your email/i.test(bodyText) &&
      document.querySelector('input[maxlength="6"], input[maxlength="4"]')) {
    return 'otp';
  }
  // Signup
  if (/create.?account|sign.?up|register/i.test(bodyText) && hasPassword) return 'signup';
  // Login
  if (hasPassword && !hasFileUpload) return 'login';
  // Confirmation
  if (/application submitted|thank you for applying|we received/i.test(bodyText)) return 'confirmation';
  // Application form
  if (hasFileUpload || (document.querySelectorAll('input, textarea').length > 4)) return 'application_form';
  
  return 'intermediate';
}
```

For login pages, check `chrome.storage.local` for stored credentials keyed by hostname:
```typescript
async function handleLoginPage(profile: UserProfile): Promise<void> {
  const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email"]');
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  
  if (emailInputs.length && passwordInputs.length) {
    // Check for stored creds
    const { creds } = await chrome.storage.local.get(`creds_${location.hostname}`);
    
    if (creds) {
      injectReactField(emailInputs[0] as HTMLInputElement, creds.email);
      injectReactField(passwordInputs[0] as HTMLInputElement, creds.password);
      // Don't auto-submit — let user verify
      chrome.runtime.sendMessage({ action: 'notify', message: 'Filled login — please review and submit' });
    } else {
      // Fill email from profile, leave password for user
      injectReactField(emailInputs[0] as HTMLInputElement, profile.email);
      chrome.runtime.sendMessage({ action: 'hitl_needed', type: 'login_password', hostname: location.hostname });
    }
  }
}
```

---

### 22. Gmail OAuth for OTP Reading

For account creation flows where the ATS sends an email OTP:

**Manifest additions:**
```json
"permissions": ["identity", "storage"],
"oauth2": {
  "client_id": "YOUR_GOOGLE_OAUTH_CLIENT_ID",
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"]
}
```

**Background OTP reader:**
```typescript
// background.ts
async function waitForOTPEmail(afterMs: number, timeout = 60000): Promise<string | null> {
  const token = await getGoogleOAuthToken(['https://www.googleapis.com/auth/gmail.readonly']);
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000)); // poll every 3 seconds

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=subject:(verification OR OTP OR code) newer_than:5m&maxResults=3`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    if (!listData.messages?.length) continue;

    // Read latest message snippet
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${listData.messages[0].id}?format=metadata&metadataHeaders=snippet`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const msgData = await msgRes.json();
    const snippet = msgData.snippet || '';
    
    // Extract 4-8 digit OTP
    const otp = snippet.match(/\b(\d{4,8})\b/)?.[1];
    if (otp) return otp;
  }
  return null;
}
```

When `classifyPage()` returns `'otp'`:
1. Background sends message to content script: "OTP page detected, reading email"
2. `waitForOTPEmail()` polls Gmail
3. OTP injected automatically via `injectReactField`

---

### 23. HITL Save Condition Too Restrictive

Current condition for saving HITL answers to AnswerBank:
```typescript
if (targetField && (targetField.type === 'textarea' || targetField.label.length > 25)) {
  await saveAnswerToBank(targetField.label, val);
}
```

Short-label fields like "Notice Period", "CTC Expected", "GitHub URL" are never saved. This means the user answers the same questions repeatedly across different applications.

**Fix — save ALL HITL-resolved answers (the user explicitly provided them):**
```typescript
// All HITL answers come from the user — all are worth saving
for (const [fieldId, val] of Object.entries(userAnswers)) {
  if (!val || val.trim().length < 2) continue;
  const field = this.state.fields.find(f => f.id === fieldId);
  if (field) {
    await saveAnswerToBank(field.label, val);
    // Also save with normalized label for better semantic matching
    const normalised = field.label.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (normalised !== field.label.toLowerCase()) {
      await saveAnswerToBank(normalised, val);
    }
  }
}
```

---

### 24. Company-Specific AnswerBank Entries

"Why do you want to join us?" at Razorpay and at an unknown startup should have different answers. The current AnswerBank has no company context — the semantic search may return a Google-specific "Why join us" answer for a Razorpay application.

**Schema addition:**
```prisma
model AnswerBank {
  // ... existing fields
  companyName  String?   // null = generic answer
  domainTag    String?   // "fintech" | "infra" | "devtools" | "b2c" etc.

  @@index([companyName])
}
```

**Lookup modification in `autofillGraph.ts`:**
```typescript
// Priority: company-specific > domain-specific > generic
const specificAnswer = await prisma.$queryRaw<any[]>`
  SELECT question, answer,
         (1 - (embedding_vec <=> cast(${vectorStr} as vector))) AS similarity,
         CASE WHEN company_name = ${this.state.companyName} THEN 0.15 ELSE 0 END AS company_boost
  FROM "AnswerBank"
  ORDER BY (1 - (embedding_vec <=> cast(${vectorStr} as vector))) + company_boost DESC
  LIMIT 5
`;
```

When saving an answer, tag it with the company name if it mentions the company or is "Why join us" type:
```typescript
const isCompanySpecific = /why.*join|why.*company|why.*us|interest.*company/i.test(field.label);
await saveAnswerToBank(field.label, val, isCompanySpecific ? this.state.companyName : undefined);
```

---

## VI. Smarter / More Personalised Agent Behaviour

### 25. Dynamic Pre-screen Blocklist from Skip History

The current `PRESCREEN_SKIP_TITLES` is a static regex array. The user may skip many roles that aren't on the list (e.g., "Cloud Infrastructure Engineer"). This knowledge is lost.

**Fix — derive a soft blocklist from skip signals:**
```typescript
// In scorer.ts — before title pre-screen check
async function getDynamicBlockTerms(): Promise<string[]> {
  const cached = await redis.get('dynamic:block_terms');
  if (cached) return JSON.parse(cached);

  const skippedRaw = await redis.lrange('feedback:skipped', 0, 29);
  const skipped = skippedRaw.map(s => JSON.parse(s) as FeedbackSignal);
  
  // Extract title words that appear in 3+ skipped jobs
  const wordFreq: Record<string, number> = {};
  skipped.forEach(s => {
    s.title.toLowerCase().split(/\s+/).forEach(w => {
      if (w.length > 4) wordFreq[w] = (wordFreq[w] || 0) + 1;
    });
  });
  
  const blockTerms = Object.entries(wordFreq)
    .filter(([_, count]) => count >= 3)
    .map(([term]) => term);
  
  await redis.set('dynamic:block_terms', JSON.stringify(blockTerms), 'EX', 3600);
  return blockTerms;
}
```

Add these terms to the soft-block path (reduce `domainFit`, not hard skip) during scoring.

---

### 26. Score Drift Detection — Alert When Calibration Is Off

If the user consistently approves jobs that Gemini scores 55-65, the scoring model is systematically low. This is detectable from feedback signals.

**Add to recalibration worker:**
```typescript
// Check for systematic score drift
const approvedAvgScore = approvedSignals.reduce((a, s) => a + s.score, 0) / approvedSignals.length;
const skippedAvgScore = skippedSignals.reduce((a, s) => a + s.score, 0) / skippedSignals.length;

// Healthy range: approved avg > 70, skipped avg < 60
if (approvedAvgScore < 65) {
  // Scoring model is systematically conservative
  // Emit a warning event the dashboard can surface
  await redis.set('scoring:drift_warning', JSON.stringify({
    type: 'CONSERVATIVE',
    approvedAvg: approvedAvgScore,
    message: `Approving jobs scored ${approvedAvgScore.toFixed(0)} avg — consider lowering fitScoreThreshold or recalibrating weights`,
    timestamp: Date.now(),
  }), 'EX', 86400);
}
```

Dashboard polls for `scoring:drift_warning` and shows a calibration recommendation banner.

---

### 27. Profile Embedding Should Also Recompute on `profileJson` Change

`PATCH /settings/profile` triggers `ensureProfileEmbedding()` only when `baseResumeLatex` changes. But if `profileJson` is updated (e.g., user completes onboarding wizard after initial seed), the profile embedding is NOT recomputed. The cluster embeddings are recomputed (`recomputeClusterEmbeddings` is called), but the flat `profileEmbedding` remains stale.

**Fix in `settings.ts`:**
```typescript
// Recompute profile embedding for BOTH resume and profileJson changes
if (data.baseResumeLatex || data.profileJson) {
  ensureProfileEmbedding().catch(...);
}
```

---

### 28. AnswerBank Grows Without Pruning — Quality Degrades Over Time

Every Gemini-generated answer and every HITL answer is saved to AnswerBank. Over many applications, there will be hundreds of low-quality or outdated entries. Semantic search may then return a stale answer from 6 months ago.

**Fix — add a confidence/quality score and a TTL:**
```prisma
model AnswerBank {
  // ... existing fields
  useCount     Int      @default(0)  // how many times this answer was reused
  lastUsed     DateTime?
  quality      Float    @default(0.5) // 0.5 = Gemini-generated, 1.0 = user-confirmed
}
```

```typescript
// When a Gemini answer is reused without HITL correction, increment useCount
// When a HITL answer overwrites an existing one, update quality to 1.0
// Periodically prune: delete where quality < 0.3 AND lastUsed < 90 days ago
```

---

### 29. Fresh-Grad Context is Understated in Scoring Prompt

The scoring prompt says:
> "Treat '0-1 YOE' or 'Fresher/New Grad' as a 100 score"

But the model sees the Samsung internship as just "intern" without the context that it's production-level distributed systems work. The prompt should be more specific about the depth of the internship:

```typescript
// In buildBatchScoringPrompt — replace generic calibration text
const freshGradContext = profile?.profileJson
  ? `CANDIDATE CONTEXT: ${profile.profileJson.facts?.name} is a final-year B.Tech student graduating ${profile.profileJson.facts?.graduationDate || 'June 2026'}. Current role: ${profile.profileJson.facts?.currentRole || 'Intern at Samsung R&D'}. This internship involves production-grade distributed systems (PTP clock sync, audio codecs, FEC) — treat it as equivalent to 1 year of backend production experience. Any role explicitly targeting "0-3 YOE" or "New Grad" or "Fresher" should score seniorityFit >= 85.`
  : `CANDIDATE CONTEXT: Final-year B.Tech student with intern-level production distributed systems experience. Treat as 0-1 YOE candidate.`;
```

This ensures the scoring model correctly interprets the internship depth, not just the "intern" title.

---

## Priority Matrix (Backend/Agent Only)

| # | Item | Priority | Effort |
|---|---|---|---|
| 1 | Route ordering fix (`GET /queues/status`) | P0 | 5 min |
| 2 | `autofillGraph.ts` O(n) → pgvector | P0 | 1 hr |
| 3 | Scoring queue jobId deduplication | P0 | 30 min |
| 4 | `activeGraphRuns` → Redis session | P1 | 2 hr |
| 5 | Gemini rate limiter → distributed Redis | P1 | 2 hr |
| 6 | Naukri + YCombinator detail fetch | P1 | 1 hr |
| 7 | Blacklist company dedup fix | P1 | 20 min |
| 8 | `profileJson` auto-generation from seed | P1 | 1 hr |
| 9 | `simulate-score` using `scoreJDText()` | P1 | 1 hr |
| 10 | `jdStructured` reuse in autofill | P1 | 1 hr |
| 11 | `getAllScraperHealth` mget batching | P2 | 30 min |
| 12 | Feedback calibration caching | P2 | 30 min |
| 13 | Adaptive weight recalibration job | P2 | 3 hr |
| 14 | Score drift detection | P2 | 2 hr |
| 15 | Company-specific AnswerBank | P2 | 2 hr |
| 16 | Dynamic blocklist from skip history | P2 | 2 hr |
| 17 | URL param trigger + redirect propagation | P1 | 3 hr |
| 18 | Universal manifest + page type detector | P1 | 2 hr |
| 19 | Login/signup page handler | P2 | 3 hr |
| 20 | Gmail OAuth OTP reader | P3 | 5 hr |
| 21 | HITL save all answers (remove label-length gate) | P1 | 15 min |
| 22 | Description quality gate + enrichment queue | P2 | 2 hr |
| 23 | Semantic job deduplication post-scoring | P2 | 2 hr |
| 24 | Batch embedding generation in seed | P2 | 30 min |
| 25 | AnswerBank pruning + quality score | P3 | 2 hr |
| 26 | Fresh-grad context in scoring prompt | P1 | 20 min |
| 27 | Profile embedding recompute on profileJson change | P1 | 10 min |