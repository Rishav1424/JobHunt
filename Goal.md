# JobHunt — Deep Codebase Review & Architecture Audit

## Table of Contents
1. [Overall Assessment](#overall-assessment)
2. [Critical Bugs (P0)](#p0-critical-bugs)
3. [Scorer Architecture — Deep Critique & Optimization](#scorer-architecture)
4. [Auto-Applier Workflow — Full Redesign](#auto-applier-workflow)
5. [Frontend — Admin Control Panel Upgrade](#frontend-admin-control-panel)
6. [Personalized Information — Optimal Data Gathering](#personalized-information)
7. [Agent Workflow Analysis](#agent-workflow-analysis)
8. [Bottlenecks & Scalability](#bottlenecks--scalability)
9. [Medium Priority Issues (P2)](#p2-medium-priority-issues)
10. [Improvement Roadmap](#improvement-roadmap)

---

## Overall Assessment

JobHunt is genuinely impressive in scope. The HITL architecture, circuit breaker pattern, feedback calibration loop, multi-dimensional scoring, RAG-backed autofill graph, and LaTeX resume compilation pipeline are all well-conceived. The code is clean and TypeScript-strict throughout. However, three critical correctness bugs, one fundamental scalability flaw, an underbuilt scorer, and a significant UX gap in the admin panel will limit the system if left unaddressed. This review covers every layer.

---

## P0 — Critical Bugs

### 1. Race Condition in Scraping Worker

**File:** `backend/src/jobs/queues.ts`, `createScrapingWorker()`

After scraping, the worker fetches all `NEW` jobs and then marks them `SCORING` in a separate update. These two operations are not atomic. If the scheduler fires a second scrape (or a manual trigger fires mid-run), newly inserted `NEW` jobs get swept into the next update or missed entirely.

```typescript
// Current — NOT atomic
const newJobRecords = await prisma.job.findMany({ where: { status: 'NEW' } });
// — another scraper inserts NEW jobs here —
await prisma.job.updateMany({
  where: { id: { in: ids } },
  data: { status: 'SCORING' },
});
```

**Fix — single atomic UPDATE RETURNING:**

```typescript
const result = await prisma.$queryRaw<{ id: string }[]>`
  UPDATE "Job"
  SET status = 'SCORING', "updatedAt" = NOW()
  WHERE status = 'NEW'
  RETURNING id
`;
const ids = result.map((r) => r.id);
```

---

### 2. No Authentication Middleware on Any API Route

**File:** `backend/src/index.ts`, all router files

`JWT_SECRET` and `DASHBOARD_PASSWORD` exist in env but nothing actually validates a token on any route. Every endpoint — profile update, company blacklist, manual scrape trigger — is fully public to anyone who can reach port 4000.

**Fix — `requireAuth` middleware applied globally:**

```typescript
// src/api/middleware/auth.ts
export const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    jwt.verify(token, config.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Add a POST /api/auth/login route that validates DASHBOARD_PASSWORD
// and issues a signed JWT. Then in index.ts:
app.use('/api', requireAuth);
```

---

### 3. O(n) In-Memory Vector Similarity — Not Scalable

**Files:** `ragService.ts`, `answerBankService.ts`, `autofillGraph.ts`, `scorer.ts`

Every scoring call and autofill run fetches the **entire** KnowledgeChunk and AnswerBank tables and computes cosine similarity in a JavaScript loop:

```typescript
const chunks = await prisma.knowledgeChunk.findMany();  // full table scan
const results = chunks.map((chunk) => ({
  similarity: cosineSimilarity(queryVector, chunk.embedding),  // JS loop
})).sort(...);
```

Embeddings are stored as `Float[]` (PostgreSQL float arrays) — not using the `pgvector` extension. With 500+ entries this becomes the dominant runtime cost per job scored.

**Fix — enable pgvector with HNSW indexing:**

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "KnowledgeChunk" ADD COLUMN embedding_vec vector(3072);
ALTER TABLE "AnswerBank" ADD COLUMN embedding_vec vector(3072);
ALTER TABLE "UserProfile" ADD COLUMN profile_embedding_vec vector(3072);
CREATE INDEX ON "KnowledgeChunk" USING hnsw (embedding_vec vector_cosine_ops);
CREATE INDEX ON "AnswerBank" USING hnsw (embedding_vec vector_cosine_ops);
```

Then in `ragService.ts`, replace the JS loop with a single indexed query:

```typescript
const chunks = await prisma.$queryRaw`
  SELECT id, category, title, content,
         1 - (embedding_vec <=> ${queryVector}::vector) AS similarity
  FROM "KnowledgeChunk"
  ORDER BY embedding_vec <=> ${queryVector}::vector
  LIMIT ${limit}
`;
```

This converts O(n) JS computation to O(log n) PostgreSQL ANN search.

---

## Scorer Architecture

### Current Architecture Summary

The scorer runs five sequential steps per job:
1. Title pre-screen (regex blocklist)
2. Deterministic knockout (YOE + salary regex)
3. Embedding cosine similarity (profile vs JD)
4. Feedback calibration context (Redis capped lists)
5. Multi-dimensional Gemini scoring (single prompt → FitAnalysis JSON)

This is a reasonable starting point, but every one of these steps has optimization potential, and the overall prompt design has a token efficiency problem that will become painful at scale.

---

### Issue A — The Profile Embedding is a Single Flat Vector

`ensureProfileEmbedding()` strips all LaTeX tags, concatenates the resulting text, and generates one 3072-dimensional vector representing the entire candidate. This is too coarse. A single embedding averaging across PTP clock sync experience, React components, Spring Boot microservices, and competitive programming cannot produce high discriminative power for any specific job type.

**Recommended approach — cluster embeddings:**

Compute separate embeddings per profile section and store all of them:

```typescript
// UserProfile schema addition
skillsEmbedding: Float[]         // embedding of skills list
systemsEmbedding: Float[]        // embedding of distributed/real-time experience
webEmbedding: Float[]            // embedding of web/fullstack experience
projectEmbedding: Float[]        // composite of all project descriptions
```

At scoring time, compute similarity against all cluster vectors and take `max(similarities)` as the embedding score. A distributed systems role then correctly matches against `systemsEmbedding` instead of being diluted by your React experience, and vice versa for frontend-leaning fullstack roles.

---

### Issue B — The Knockout Regex Has Multiple Edge-Case Failures

**Salary range window too narrow:**

```typescript
const surrounding = combinedText.substring(
  Math.max(0, matchIndex - 10),   // only ±10 chars
  matchIndex + matchLen + 10
);
const isRangeText = /[\d]+\s*(?:-|to)\s*[\d]+/i.test(surrounding);
```

"Compensation: ₹15 – ₹25 lpa" has 14+ characters between "₹15" and "lpa". The window misses the range context and false-triggers the knockout. Widen to ±40 characters.

**YOE mention in job body triggers false positive:**

The single-number YOE regex `/\b([1-9]|\d{2})\+?\s*(?:yoe|years|yrs|years\s+of\s+experience)\b/i` will match "we have been building systems for 3 years" and set `yoeRequired = 3`, triggering a knockout for a role with no minimum YOE requirement. The regex should only fire when preceded by requirement-signal words: "minimum", "require", "at least", "must have", or when in a structured "Requirements:" section.

**Senior title regex produces false positives:**

`/\b(senior|sr\b|lead|...)` knocks out "Technical Lead (0-2 YOE)" and "Tech Lead Intern" — both legitimate target roles. Title-based hard knockout is too blunt. Convert it to a scoring penalty: set `seniorityFit = 15` instead of `score = 0`, and let Gemini decide in context. Reserve hard knockouts only for confirmed salary below `minSalaryCutoff`.

**Improved knockout logic:**

```typescript
function checkKnockout(title, description, minYoeCutoff, minSalaryCutoff) {
  // Only hard-knockout on confirmed low salary
  const salaryKnockout = checkSalaryKnockout(description, minSalaryCutoff);
  if (salaryKnockout) return { knockedOut: true, reason: salaryKnockout };

  // For YOE and seniority — return a soft penalty instead
  const seniorityPenalty = checkSeniorityPenalty(title, description, minYoeCutoff);
  return { knockedOut: false, seniorityOverride: seniorityPenalty };
}
```

---

### Issue C — Token Consumption is 17,000 Chars Per Job

Each scoring prompt contains:
- Candidate profile text: up to 8,000 chars (stripped LaTeX — poor signal density)
- Job description: 5,000 chars
- Feedback calibration: ~1,500 chars
- Scoring instructions: ~2,500 chars
- **Total: ~17,000 chars ≈ 5,000–6,000 tokens per job**

For 500 jobs per scraping cycle, that's 2.5–3M tokens per run. At scale this is expensive and slow.

**Three-part fix:**

**A — Replace LaTeX stripping with a structured profile summary:**

Instead of `buildProfileText()` producing mangled LaTeX output, maintain a `profileSummary` field (500–600 tokens) that is human-readable and structured. This alone cuts input by ~2,000 chars per prompt.

**B — Truncate and preprocess JDs before scoring:**

Extract only the signal-dense sections. The first 1,500 chars of any JD contain 90% of the scoring signal (role, requirements, tech stack). The rest is benefits, EEO disclaimers, and company boilerplate.

```typescript
function extractJDSignal(description: string): string {
  // Take up to the first occurrence of: "About us", "Benefits", "What we offer", "Equal opportunity"
  const boilerplateMarkers = /\b(about us|what we offer|benefits|perks|equal opportunity|eeo)\b/i;
  const match = description.search(boilerplateMarkers);
  const trimmed = match > 500 ? description.slice(0, match) : description;
  return trimmed.slice(0, 2500);
}
```

**C — Batch 3–5 jobs per Gemini call:**

A single prompt can score multiple jobs by returning a JSON array. This cuts API call count by 3–5x while staying within rate limits.

```typescript
// buildBatchScoringPrompt(jobs: Job[], profile: CompressedProfile): string
// Returns: Promise<FitAnalysis[]>
// 3 jobs × 1,500 chars JD + 600 chars profile + instructions ≈ 6,000 tokens total
// vs. 1 job × 5,000 chars JD + 8,000 chars profile ≈ 6,000 tokens — same cost, 3x throughput
```

---

### Issue D — Dynamic Weight Adjustment is Not Validated

Gemini can return `adjustedWeights` that deviate arbitrarily from defaults. The scorer normalizes by dividing by `sum`, but if Gemini returns `{ techStack: 0, seniorityFit: 0, domainFit: 0, compensationFit: 0, companyTier: 0 }`, sum is 0 and you divide by 0. Also, there's no constraint preventing Gemini from returning weights that effectively ignore your most important dimension. Add validation:

```typescript
function validateAndNormalizeWeights(raw: Record<string, number>, defaults: Record<string, number>) {
  const keys = Object.keys(defaults);
  // Reject if any key is missing or negative
  const valid = keys.every(k => typeof raw[k] === 'number' && raw[k] >= 0);
  if (!valid) return defaults;
  const sum = keys.reduce((acc, k) => acc + raw[k], 0);
  if (sum === 0) return defaults;
  // Constrain: no single weight > 0.5 (prevents degenerate collapses)
  const normalized = Object.fromEntries(keys.map(k => [k, raw[k] / sum]));
  const capped = Object.fromEntries(keys.map(k => [k, Math.min(normalized[k], 0.5)]));
  const cappedSum = keys.reduce((acc, k) => acc + capped[k], 0);
  return Object.fromEntries(keys.map(k => [k, capped[k] / cappedSum]));
}
```

---

### Issue E — Dream Company Boost Applied Before Score Capping

```typescript
if (raw.redFlags && raw.redFlags.length > 0) {
  finalScore = Math.min(60, finalScore);  // cap at 60 for red flags
}
if (isTargetCompany) {
  finalScore = Math.min(100, finalScore + 10);  // boost after cap
}
```

A dream company with red flags ends up at 70 (60 cap + 10 boost), bypassing the cap entirely. Decide: either the dream boost applies before capping, or red flags override the dream boost. The latter is safer:

```typescript
if (isTargetCompany && !(raw.redFlags?.length > 0)) {
  finalScore = Math.min(100, finalScore + 10);
}
```

---

### Issue F — Feedback Signal Storage is Too Sparse

The approval/skip signals store only title, company, score, and 5 tech keywords:

```typescript
interface FeedbackSignal {
  title: string;
  company: string;
  score: number;
  techStack: string;     // only 5 keywords
  verdict: string;
  timestamp: number;
}
```

This loses the most valuable information: what specific dimensions drove the score, what gaps were found, what the `whySkip` reason was. The calibration prompt then lacks the causal reasoning to adjust future scores.

**Richer signal format:**

```typescript
interface FeedbackSignal {
  title: string;
  company: string;
  companyTier: string;
  dimensions: DimensionScores;      // full breakdown
  topStrengths: string[];           // top 2
  topGaps: string[];                // top 2
  whySkip?: string;                 // for skips — the actual reason
  userComment?: string;             // free text if user adds a note
  timestamp: number;
}
```

---

### Issue G — The Pre-screening Blocklist Over-blocks Valid Roles

```typescript
/\bcloud.?engineer\b/i,   // blocks "Cloud Backend Engineer" — could be relevant
/\bsre\b/i,               // blocks SRE roles with heavy backend component
/\bembedded\b/i,          // blocks "Embedded Distributed Systems Engineer"
```

At Samsung you literally work on embedded distributed systems. The blocklist should be a soft pre-screen with a higher minimum threshold, not a hard block. Convert the title blocklist into a `domainScore = 0` signal passed to Gemini, not a bypass of Gemini entirely.

---

### Recommended Scorer Architecture

```
Job Input
    │
    ├─→ [1] Salary Hard Knockout (only confirmed low salary)
    │         └─→ score=0, save, done
    │
    ├─→ [2] Pre-screen (suspicious title)
    │         └─→ set domainPenalty flag, do NOT skip LLM
    │
    ├─→ [3] JD Signal Extraction (strip boilerplate, ≤2500 chars)
    │
    ├─→ [4] Cluster Embedding Match (max across profile clusters)
    │         └─→ embeddingScore (0-100)
    │
    ├─→ [5] Structured JD Extraction (cheap LLM: extract required YOE,
    │         must-have skills, tech stack as JSON — reusable for autofill too)
    │
    ├─→ [6] Batch Gemini Scoring (3 jobs per call)
    │         └─→ FitAnalysis[] with validated/capped weights
    │
    └─→ [7] Score Finalization
              ├─ Apply seniority penalty if detected
              ├─ Apply red flag cap (60) if flags found
              ├─ Apply dream company boost (+10) only if no red flags
              └─ Persist + emit WebSocket
```

---

## Auto-Applier Workflow

### Current Flow Summary

```
User navigates to job page
    → Extension detects URL → backend /api/jobs/detect
    → User clicks "Start Auto-Fill"
    → Socket connects → content script scrapes form fields
    → Backend autofill graph:
        Node 1: static field matching (regex substring)
        Node 2: AnswerBank exact match → RAG + Gemini batch
        Node 3: HITL pause for gaps
        Node 4: compileTailoredResume()
    → Extension injects values via native setter trick
    → User manually uploads resume PDF + clicks submit
```

### Gap 1 — Resume File Upload is Manual, Not Automated

The biggest gap in the entire system is here. `tailoredResumeUrl` is returned to the extension, and the UI says "drag & drop it into the Attach Resume field." This isn't automation — it's assistance. True automation requires the extension to programmatically upload the file:

```typescript
// In content.ts — inject file into a file input
async function injectFile(fieldId: string, fileUrl: string, filename: string) {
  const input = document.getElementById(fieldId) as HTMLInputElement;
  
  // Fetch the PDF from the backend
  const response = await fetch(fileUrl);
  const blob = await response.blob();
  const file = new File([blob], filename, { type: 'application/pdf' });
  
  // Use DataTransfer to inject — works on most ATS forms
  const dt = new DataTransfer();
  dt.items.add(file);
  
  const nativeInputValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'files'
  )?.set;
  nativeInputValue?.call(input, dt.files);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
```

This requires `host_permissions` to include the storage origin and the content script to have fetch access, but it closes the loop on full automation.

---

### Gap 2 — Static Field Matching is Substring-Only

`matchStaticFields()` checks `normLabel.includes('name')` and similar patterns. Fields labeled "What should we call you?", "Legal Name (as on ID)", or "Preferred First Name" all fail to match despite being trivially name fields.

**Fix — use lightweight embedding similarity for static fields:**

Pre-compute embeddings for a canonical field vocabulary at startup:

```typescript
const CANONICAL_FIELDS = {
  full_name:  'full name applicant name',
  first_name: 'first name given name',
  last_name:  'last name surname family name',
  email:      'email address work email',
  phone:      'phone number mobile contact',
  linkedin:   'linkedin profile linkedin url',
  github:     'github url github profile',
  location:   'current location city address',
};
// Embed these once at startup and cache in Redis
```

At autofill time, embed each scraped field label and find the nearest canonical field. Similarity > 0.85 → use that mapping. This handles arbitrary phrasing without regex maintenance.

---

### Gap 3 — No Multi-Page Form Support

ATS systems like Workday, SAP SuccessFactors, and Taleo use multi-step forms where each page is a separate DOM. The current implementation runs `scrape_form` once and assumes all fields are present. Multi-page detection needs to be added:

```typescript
// content.ts — detect pagination
function detectFormPagination(): { isMultiPage: boolean; currentPage: number; totalPages?: number } {
  const paginationEl = document.querySelector(
    '[class*="step"], [class*="page-indicator"], [aria-label*="step"], [class*="wizard"]'
  );
  const nextBtn = document.querySelector(
    'button[data-next], button:has-text("Next"), button:has-text("Continue")'
  );
  return {
    isMultiPage: !!paginationEl || !!nextBtn,
    currentPage: extractCurrentPageNumber(),
  };
}
```

The extension should fill the current page, click "Next", wait for page transition, scrape again, and repeat — with the socket session tracking which page it's on.

---

### Gap 4 — No Pre-Inject Preview

The current flow injects immediately with no opportunity for the user to review planned values before they hit the form. A "Preview Mode" should be shown in the sidebar before any injection:

```
┌─────────────────────────────────────────────┐
│  Ready to fill 8 fields                     │
│                                             │
│  ✅ Full Name         → Rishav Sharma       │
│  ✅ Email             → sharmarishav676@... │
│  🤖 Why join us?      → I'm drawn to your   │
│                         distributed...      │
│  ⚠️  Notice Period    → [needs your input]  │
│  📄 Resume PDF        → Will upload after   │
│                         HITL resolved       │
│                                             │
│  [Edit]     [Inject All →]                  │
└─────────────────────────────────────────────┘
```

This transforms the tool from "AI guesses and injects" to "AI proposes, you approve."

---

### Gap 5 — No Post-Injection Validation

After injecting, there's no check that the values actually stuck. React controlled inputs sometimes reject the native setter if the component has additional validation. The extension should re-scrape all field values after injection and compare:

```typescript
async function validateInjection(planned: Record<string, string>): Promise<ValidationReport> {
  const current = scrapeCurrentValues();   // get actual DOM values after injection
  const mismatches = Object.entries(planned).filter(
    ([id, value]) => current[id] !== value
  );
  return { success: mismatches.length === 0, failedFields: mismatches };
}
```

Any mismatches are surfaced in the sidebar with a "Retry field" button.

---

### Gap 6 — No Application Confirmation Loop

After the user manually clicks Submit, the application is not automatically marked as `APPLIED` in the database. The user has to go back to the dashboard and update it manually. The extension should detect the confirmation page:

```typescript
// content.ts — watch for confirmation
const observer = new MutationObserver(() => {
  const confirmationSignals = [
    'application submitted', 'thank you for applying',
    'we received your application', 'application complete'
  ];
  const pageText = document.body.innerText.toLowerCase();
  if (confirmationSignals.some(s => pageText.includes(s))) {
    chrome.runtime.sendMessage({
      action: 'application_confirmed',
      jobId: currentJobId,
    });
  }
});
observer.observe(document.body, { childList: true, subtree: true });
```

The background script then calls `PATCH /api/jobs/:id/status` with `APPLIED`.

---

### Recommended Auto-Applier Architecture

```
[Extension Sidebar]
    │
    ├─ 1. Page Load → Detect job URL → /api/jobs/detect
    │       └─ Not found? → Offer to add job to DB
    │
    ├─ 2. User clicks "Start"
    │       ├─ content.ts: scrapeForm() + detectFormPagination()
    │       └─ Socket → autofill:start { jobId, fields, pageInfo }
    │
    [Backend Graph]
    ├─ 3. Node: StaticFieldMatch (embedding similarity vs canonical vocab)
    ├─ 4. Node: JDStructuredExtract (reuse scorer's JD extraction)
    ├─ 5. Node: AnswerBankLookup (exact + semantic cache)
    ├─ 6. Node: BatchGeminiCustomFields
    ├─ 7. Node: HITLGapCollection (if any gaps)
    ├─ 8. Node: ResumeTailorQueue (BullMQ job, not blocking)
    │
    ├─ 9. Sidebar: Show Preview Panel (all planned values)
    │       └─ User reviews + edits + approves
    │
    ├─ 10. content.ts: injectFields() + injectFile()
    │        └─ validateInjection() → retry failed fields
    │
    ├─ 11. Multi-page: detect Next button → repeat from step 2
    │
    └─ 12. Confirmation detector → auto-mark APPLIED in DB
```

---

## Frontend — Admin Control Panel

The current dashboard is a read-mostly display. A full admin panel should give you complete observability and control over every component of the system without touching the terminal.

### What Needs to Be Added

**Live System Status Bar (global — top of every page):**

```
● PostgreSQL   ● Redis   ● Gemini API   ● Workers (2/2)   Scraping Queue: 0   Scoring Queue: 23 pending
```

Powered by a `GET /api/system/health` endpoint returning service connectivity, queue depths, and active worker counts. Updates via WebSocket every 10 seconds.

---

**Dashboard Page — Upgrade:**

Current: 4 stat cards + source breakdown bar + quick links.

Add:
- **Live scoring ticker**: real-time feed of jobs being scored as they complete, with company, title, and score (already have `job:scored` socket event — just surface it)
- **Dream company alert panel**: a dedicated section that highlights any dream company job found in the last 24 hours, regardless of score threshold, above the fold
- **Scraper run log**: last 5 scraping runs with per-scraper result (OK / FAILED / CIRCUIT_OPEN) — the data comes from `scraperHealth` in the stats endpoint
- **Gemini API health indicator**: RPM used vs limit (infer from last-minute call timestamps stored in Redis)

---

**Job Queue Page — Upgrade:**

Current: grid of job cards with Approve/Skip buttons and search.

Add:
- **Bulk actions toolbar**: "Approve all ≥ 80", "Skip all ≤ 40", "Rescore selected" with checkboxes on each card
- **Advanced filter panel**: filter by company tier (MNC/startup/service), by source, by salary range, by domain relevance, by whether it's a dream company
- **Column/list view toggle**: the card grid is good for review but a dense list view (like a spreadsheet) is faster for bulk processing
- **Per-job quick-action menu**: right-click or kebab menu → Approve / Skip / Blacklist Company / Rescore / View Raw JD

---

**New Page: Scraper Control Center (`/scrapers`):**

This page doesn't exist and should. It gives you per-scraper observability and manual control:

```
┌──────────────────────────────────────────────────────────────┐
│  Scraper Control Center                        [Run All Now]  │
├─────────────────┬─────────┬──────────┬──────────┬───────────┤
│  Scraper        │  State  │ Failures │ Last Run │  Action   │
├─────────────────┼─────────┼──────────┼──────────┼───────────┤
│  adzuna         │ ✅ OK   │  0/3     │ 2h ago   │ [Run] [⏸]│
│  linkedin       │ ✅ OK   │  1/3     │ 2h ago   │ [Run] [⏸]│
│  naukri         │ 🔴 OPEN │  3/3     │ 4h ago   │ [Reset]   │
│  wellfound      │ 🟡 HALF │  2/3     │ 6h ago   │ [Test]    │
│  remoteok       │ ✅ OK   │  0/3     │ 2h ago   │ [Run] [⏸]│
└─────────────────┴─────────┴──────────┴──────────┴───────────┘
```

Buttons call new API endpoints:
- `POST /api/scrapers/:name/run` — trigger single scraper
- `POST /api/scrapers/:name/reset-circuit` — manually reset an OPEN circuit breaker
- `PATCH /api/scrapers/:name/enabled` — toggle enabled/disabled

---

**New Page: Queue Monitor (`/queues`):**

Replaces the separate Bull Board container (port 3001). Embed queue stats directly in the dashboard:

- Scraping queue: pending / active / completed / failed jobs
- Scoring queue: same, plus estimated time to clear at current RPM
- Failed jobs list with retry button
- A "drain queue" button that clears all pending scoring jobs (useful when you want to run fresh scraping)

---

**New Page: Resume Studio (`/resume`):**

A dedicated workspace for resume management:

- **Left panel**: Monaco LaTeX editor (already in Settings — move it here)
- **Right panel**: PDF preview (use a `pdflatex` → `iframe` pipeline or YtoTech API live preview)
- **Below**: list of all tailored resumes generated, grouped by company, with diff viewer showing what changed vs base
- **Version history**: each save of `baseResumeLatex` creates a snapshot in a new `ResumeVersion` table so you can roll back

---

**New Page: Company Intelligence (`/companies`):**

- Table of all companies in `CompanyTier` cache with their Gemini-classified tier
- Ability to manually override tier for any company
- Target companies with their job count and avg fit score
- Blacklisted companies with remove button

---

**Application Pipeline — Upgrade:**

Current: list with status tabs.

Add:
- **Kanban board view**: drag cards between status columns (PENDING → APPLIED → INTERVIEW → OFFER)
- **Application timeline**: per-application timeline showing scraped → scored → approved → applied → email events
- **Email event thread**: when Gmail tracking is connected (Phase 5), show email threads per application inline
- **Notes field**: free-text notes per application, visible in the kanban card

---

**Settings Page — Upgrade:**

Add a **Scoring Simulator** section:

```
Paste a job description below and see how your current settings would score it:

[JD textarea]                    [Simulate Scoring →]

Result:
  Seniority Fit:    85/100
  Tech Stack:       72/100
  Domain Fit:       95/100
  Compensation:     unknown → estimated 80/100
  Company Tier:     unknown → estimated 60/100
  ──────────────────────────
  Final Score:      79/100 — Good Match

Adjust dimension weights and re-run to tune your scoring calibration.
```

This lets you tune weights interactively before committing them to the DB.

---

## Personalized Information

### The Problem with the Current Approach

The system currently relies on parsing your LaTeX resume as the primary source of candidate information. LaTeX-stripped text fed into Gemini as the "candidate profile" has poor signal density — the scorer has to infer your skill depth, experience relevance, and preferences from a document designed for human readers, not machine evaluation.

The autofill system generates fresh answers to "Why do you want to join us?" every time, producing inconsistent answers across applications for the same type of company.

The feedback calibration loop stores only 5 keywords per signal, which is too sparse to drive meaningful score drift.

### What Information the System Actually Needs

There are five distinct data categories, each used differently:

**Category 1 — Static Facts (used by autofill static matching and score prompt)**

The system already has most of these, but they should be in structured fields, not parsed from LaTeX:

```json
{
  "name": "Rishav Sharma",
  "graduationDate": "June 2026",
  "collegeName": "NIT Durgapur",
  "degree": "B.Tech Electrical Engineering",
  "cgpa": "7.5/10",
  "currentRole": "SDE Intern at Samsung R&D Institute India",
  "currentLocation": "Kolkata, India",
  "openToRelocate": true,
  "targetLocations": ["Bangalore", "Hyderabad", "Mumbai", "Remote"],
  "noticePeriod": "Immediate (graduating June 2026)",
  "workAuthorization": "Indian Citizen — no visa needed"
}
```

**Category 2 — Technical Skill Depth (used by scorer's tech stack dimension and autofill)**

Not just a flat list, but depth + context:

```json
{
  "skills": [
    { "name": "Java", "level": "strong", "monthsProduction": 18, "context": "Primary DSA language, Spring Boot backend, Samsung internship" },
    { "name": "Spring Boot", "level": "strong", "monthsProduction": 8, "context": "Distributed chess platform, real-time matchmaking backend" },
    { "name": "WebSockets / STOMP", "level": "strong", "monthsProduction": 6, "context": "Sub-100ms move sync in chess, PTP sync at Samsung" },
    { "name": "Node.js", "level": "comfortable", "monthsProduction": 10, "context": "CampusCord chat, E-Summit backend" },
    { "name": "React", "level": "comfortable", "monthsProduction": 8, "context": "Chess client, CampusCord frontend" },
    { "name": "Redis", "level": "comfortable", "monthsProduction": 6, "context": "Session management, pub/sub in chess platform" },
    { "name": "Python / Django", "level": "comfortable", "monthsProduction": 4, "context": "E-Summit platform" },
    { "name": "C++", "level": "comfortable", "monthsProduction": 3, "context": "Competitive programming, memory management concepts" },
    { "name": "Go", "level": "familiar", "monthsProduction": 0, "context": "Studied conceptually, not used in production" }
  ]
}
```

This directly answers the scorer's question: "what tech does Rishav have at Strong/Comfortable/Familiar level?" without requiring Gemini to infer it from resume text.

**Category 3 — Career Preferences (used by scorer's domain and company tier dimensions)**

```json
{
  "rolePreferences": {
    "primary": ["Backend Engineer", "SDE", "Distributed Systems"],
    "acceptable": ["Full Stack Engineer", "Platform Engineer"],
    "avoid": ["Frontend-only", "Mobile", "ML/AI", "QA", "DevOps"]
  },
  "companyPreferences": {
    "primaryTargets": ["Razorpay", "CRED", "Zepto", "BrowserStack", "Postman", "Nutanix"],
    "stretchTargets": ["Google", "Microsoft", "Atlassian", "Stripe", "Cloudflare"],
    "acceptable": "Any product-focused company with strong engineering culture",
    "avoid": "Pure IT services, body-shopping, consulting-heavy shops"
  },
  "workModePreference": "Hybrid or remote — open to in-office for top-tier companies",
  "domainInterests": ["fintech infrastructure", "real-time systems", "developer tools", "distributed databases"],
  "dealBreakers": ["pure QA role", "no backend component", "WITCH companies", "legacy COBOL/mainframe"]
}
```

**Category 4 — Compensation (used by scorer's compensation dimension)**

```json
{
  "minimumCTC": 15,
  "idealCTC": 25,
  "maximumFlexibility": "Would accept 12 LPA for Google/Microsoft/Razorpay as a deliberate brand trade-off",
  "equityPreference": "Nice to have but not a deciding factor at this stage",
  "currency": "INR_LPA"
}
```

**Category 5 — Behavioral Answer Bank (used by autofill for open-ended questions)**

This is the highest-leverage category for the autofill system. Pre-write canonical answers to 15–20 common application questions. These are stored directly in `AnswerBank` with embeddings, and the autofill RAG lookup finds them without any Gemini call:

```
Q: "Why do you want to work here?"
A: "I'm drawn to companies solving hard infrastructure problems at scale. Your work on [domain] particularly resonates because my Samsung internship work on PTP clock synchronization and my distributed chess platform have given me a deep appreciation for the engineering challenges in real-time, low-latency systems. I want to push that further in a product context where the impact compounds."

Q: "Describe a complex technical challenge you faced."
A: "At Samsung R&D, I needed to synchronize audio playback across multiple devices with sub-5μs precision — a problem where standard NTP was insufficient by two orders of magnitude. I implemented Precision Time Protocol (PTP/IEEE 1588), designed a multi-device audio mesh, and then layered Forward Error Correction to maintain zero-dropout playback under 15% packet loss. The result was a system that stayed synchronized within the hardware clock's own drift margin across all test environments."

Q: "What is your greatest weakness?"
A: "..."

Q: "Tell me about a time you led a team."
A: "..."

[15-20 such Q&A pairs covering all behavioral categories]
```

### Recommended Information Gathering Approach

Build a one-time onboarding wizard in the Settings page (5 steps, 10–15 minutes total):

```
Step 1 — Basic Facts (auto-populated from existing profile, user confirms)
Step 2 — Technical Skill Depth (dropdown per skill: Strong / Comfortable / Familiar + months)
Step 3 — Career Preferences (checkbox lists + free-text for deal-breakers)
Step 4 — Compensation (simple number inputs with optional notes)
Step 5 — Behavioral Q&A (pre-loaded question list, user types answers)
```

On completion, the wizard:
- Writes `profileJson` to `UserProfile`
- Seeds `AnswerBank` with the behavioral Q&As (embeddings computed in background)
- Re-computes cluster embeddings per skill category
- Runs a `dry-score` on 5 recent scored jobs to show the user how the richer profile would have changed their scores

This replaces the current LaTeX-parsing approach for all scoring and autofill decisions. The LaTeX resume continues to be used only for what it's actually good for: generating tailored PDF resumes.

---

## Agent Workflow Analysis

### The Central Workflow Gap

The most significant agent workflow gap is that the profile editor in Settings and the scorer are partially disconnected. When you update your LaTeX resume:

1. `PATCH /api/settings/profile` clears `profileEmbedding` and triggers `ensureProfileEmbedding()` ✅
2. The profile embedding is recomputed from LaTeX text ✅
3. But `KnowledgeChunk` entries (used by autofill RAG) remain stale ❌
4. And the `candidateProfileText` in the scoring prompt is re-built from LaTeX at scoring time using the lossy regex stripper ❌

**Fix:** The profile update hook should trigger three things: embedding recomputation, KnowledgeChunk reseeding, and `profileJson` regeneration (all three async in background via BullMQ jobs, not inline).

---

### Autofill Graph Specific Issues

**Hardcoded profile ID:** `prisma.userProfile.findUnique({ where: { id: 'rishav-profile' } })` appears in `autofillGraph.ts`, `seed.ts`, and `resumeCompiler.ts`. This makes the system entirely non-portable. Replace with `findFirst()` everywhere and let the single-user model fall out naturally from having only one profile row.

**`compileTailoredResume()` returns cached path without checking disk:** If the storage volume is wiped (which happens between Docker container recreations without a named volume), `existingApp.tailoredResumePdfPath` returns a path to a file that no longer exists. The extension downloads a 404. Add `fs.existsSync(fullPath)` before returning the cache hit.

**HITL field categorization is binary:** Either the AI can answer a field or it's UNRESOLVED_GAP. A third category is missing: fields that can be answered deterministically from the structured profile without the AI (expected graduation date, notice period, current CGPA). These should be resolved in a pre-processing pass before the Gemini batch call, reducing HITL frequency and API usage.

---

## Bottlenecks & Scalability

### Bottleneck 1 — Sequential Scraping with 5 Browser Processes

Five Playwright scrapers each create a `chromium.launch()` call sequentially. Five separate browser instances at 200–500MB each means 1–2.5GB RAM consumption during a scraping run.

**Fix — shared browser pool with isolated contexts:**

```typescript
// src/services/scrapers/browserPool.ts
class PlaywrightBrowserPool {
  private browser: Browser | null = null;

  async acquire(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({ headless: true, ... });
    }
    return this.browser;
  }

  async newContext(): Promise<BrowserContext> {
    const browser = await this.acquire();
    return browser.newContext({ userAgent: getRandomItem(USER_AGENTS), ... });
  }
}
export const browserPool = new PlaywrightBrowserPool();
```

Each scraper calls `browserPool.newContext()`, uses it, and closes the context (not the browser). Single browser, multiple isolated sessions, 60–70% RAM reduction.

### Bottleneck 2 — KnowledgeChunks Stale After Profile Updates

When you update your LaTeX resume, `ensureProfileEmbedding()` recomputes the profile vector. But `KnowledgeChunk` entries are only created at seed time. Updated Samsung internship bullets or new projects are invisible to the autofill RAG system until you manually re-run `db:seed`.

**Fix:** Trigger `reseedKnowledgeChunks()` from the profile update endpoint as a background BullMQ job.

### Bottleneck 3 — `requeue-all-scored.ts` Can Wipe Actioned Jobs

This script marks ALL jobs with `status: 'SCORED'` back to `SCORING` and clears their `fitScore`. There is no guard protecting jobs that were already `APPROVED`, `APPLIED`, or `SKIPPED` — but those are filtered by the `where` clause correctly. The real problem is there is no guard against running this while the scoring worker is mid-flight, creating double-queue entries. Add an explicit drain step before requeue:

```typescript
// Drain existing scoring queue first
await scoringQueue.drain();
// Then proceed with requeue
```

### Bottleneck 4 — LinkedIn Scraper Will Get Rate-Limited

The stealth plugin helps with fingerprinting but LinkedIn's bot detection also uses behavioral signals: page dwell time, scroll velocity, click timing. The current scraper uses `waitForTimeout(3000)` uniform delays which are statistically detectable. Add jitter:

```typescript
const delay = 2000 + Math.random() * 3000;  // 2–5s random delay
await page.waitForTimeout(delay);
```

More importantly, redirect LinkedIn scraping budget to Naukri and Wellfound for Indian roles — they're far less aggressive.

---

## P2 — Medium Priority Issues

### Company Tier List Fragmentation

Company lists appear in three places: `seed.ts` hardcoded arrays, `Settings` DB fields, and the `CompanyTier` DB table. Re-running `db:seed` overwrites UI-edited company lists. Fix the seed script to skip company list updates when a Settings row already exists.

### Frontend Type Mismatches

`Application.changesSummary` is typed as `string[]` in `api.ts` but stored as `Json` in Prisma — null vs array distinction is not handled at call sites. `FitAnalysis` is missing `adjustedWeights?: Record<string, number>` which the backend now returns. `Job.fitAnalysis.dimensions` can be undefined when `prescreenPassed: false` but the detail page accesses it without optional chaining.

### Socket Client Has No Error Handling

`getSocket()` creates a singleton with no `connect_error` handler. When the backend is down, the dashboard hangs silently. Surface connection state to the UI:

```typescript
socket.on('connect_error', () => connectionStore.setState({ connected: false }));
socket.on('connect', () => connectionStore.setState({ connected: true }));
```

### Enabled Sources Seed/UI Mismatch

The seed script sets `enabledSources` with only 5 scrapers but the settings UI lists 8. Because of `?? true` defaults, the 3 extra scrapers appear enabled in the UI even before they're saved. Seed all 8 scrapers explicitly and change the frontend default to `?? false`.

### RemoteOK USD Conversion Hardcoded

`const lpaMin = usdMin ? (usdMin * 83) / 100000 : undefined` uses a hardcoded exchange rate. Fetch the rate from a free FX API on worker startup and cache it in Redis for 24 hours.

---

## Improvement Roadmap

### Phase 1 — Fix Correctness (Week 1)
- Add auth middleware (JWT verify on all `/api/*` routes)
- Fix race condition in scraping worker (atomic `UPDATE RETURNING`)
- Fix requeue scripts (drain queue first, add status guards)
- Fix knockout regex (widen salary window, convert title-knockout to penalty)
- Sync `getAllScraperHealth()` to use `Object.keys(ALL_SCRAPERS)`
- Fix seed.ts to skip company list overwrite on re-runs
- Fix dream company boost to not bypass red flag cap

### Phase 2 — Scalability (Weeks 2–3)
- Enable pgvector, add HNSW indexes, migrate embedding columns
- Implement Playwright browser pool
- Implement batch scoring (3 jobs per Gemini call)
- Compress candidate profile in scoring prompt using structured JSON
- Add KnowledgeChunk reseeding trigger on profile update
- Store autofill session state in Redis

### Phase 3 — Scorer Quality (Weeks 3–4)
- Implement cluster embeddings per profile section
- Build structured `profileJson` alongside LaTeX
- Validate and constrain dynamic weight adjustments
- Implement structured JD extraction (cheap pre-pass before scoring)
- Enrich feedback signal format with dimensions and reasons
- Convert title blocklist from hard-knockout to scoring penalty

### Phase 4 — Auto-Applier (Weeks 4–5)
- Implement file input injection (DataTransfer API)
- Add pre-inject preview panel in extension sidebar
- Add post-injection validation + retry for failed fields
- Add multi-page form detection and traversal
- Add confirmation page detection + auto-mark APPLIED
- Decouple resume compilation from autofill graph into separate BullMQ queue

### Phase 5 — Admin Panel (Weeks 5–6)
- Add `/scrapers` page with per-scraper control
- Add `/queues` page (embed Bull Board data, replace port 3001)
- Add `/resume` Resume Studio page
- Add `/companies` Company Intelligence page
- Upgrade dashboard with live scoring ticker and dream company alerts
- Add scoring simulator in Settings
- Add job bulk actions and column view in Job Queue
- Add Kanban view and timeline in Applications

### Phase 6 — Information Gathering (Ongoing)
- Build onboarding wizard (5 steps, structured profile collection)
- Pre-write 15–20 behavioral Q&A answers → seed AnswerBank
- Implement cluster embeddings
- Run dry-score comparison to validate profile improvement
- Set up monthly "profile refresh" reminder to update project metrics

---

## Quick Reference: Files Needing Attention

| File | Issue | Priority |
|---|---|---|
| `src/jobs/queues.ts` | Race condition on NEW→SCORING | P0 |
| `src/index.ts` | No auth middleware | P0 |
| `src/services/ai-engine/ragService.ts` | O(n) similarity search | P0 |
| `src/services/ai-engine/autofillGraph.ts` | In-memory session state, hardcoded profile ID | P1 |
| `src/services/ai-engine/scorer.ts` | Knockout edge cases, 17k token prompts, dream boost order | P1 |
| `src/services/ai-engine/feedback.ts` | Sparse signal format | P1 |
| `src/services/ai-engine/resumeCompiler.ts` | No disk existence check on cached PDF | P1 |
| `src/core/scraperHealth.ts` | Hardcoded scraper names | P1 |
| `src/scripts/seed.ts` | Overwrites user company lists on re-run | P2 |
| `src/scripts/requeue-all-scored.ts` | No queue drain before requeue | P1 |
| `frontend/src/lib/api.ts` | Stale types, missing fields | P2 |
| `frontend/src/lib/socket.ts` | No error handler, no cleanup | P2 |
| `extension/src/content.ts` | Only covers Lever + Greenhouse | P1 |
| `extension/src/App.tsx` | No pre-inject preview, no post-inject validation | P1 |
