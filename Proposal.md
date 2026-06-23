# JobHunt — Complete Architectural Overhaul Roadmap

> **Project:** Personal automated job hunting platform  
> **Author:** Rishav Sharma  
> **Last Updated:** June 2026  
> **Status:** Planning → Execution

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Target Architecture](#2-target-architecture)
3. [Phase 0 — Profile Data Foundation](#phase-0--profile-data-foundation)
4. [Phase 1 — Job Refinement Pipeline](#phase-1--job-refinement-pipeline)
5. [Phase 2 — Content Script Rewrite](#phase-2--content-script-rewrite)
6. [Phase 3 — Autofill Agent State Machine](#phase-3--autofill-agent-state-machine)
7. [Phase 4 — Learning Loop](#phase-4--learning-loop)
8. [Phase 5 — Frontend & Extension Polish](#phase-5--frontend--extension-polish)
9. [Execution Order & Dependencies](#execution-order--dependencies)
10. [Success Criteria](#success-criteria)
11. [Appendix A — ProfileData.md Template](#appendix-a--profiledatamd-template)
12. [Appendix B — File Change Index](#appendix-b--file-change-index)

---

## 1. Problem Statement

### What is broken right now

**Job Data Quality**
- Scraped titles contain noise: `"Urgent!! Sr. SDE-II (6+ YOE) Bangalore | Naukri Hiring"`
- Locations contain metadata: `"Bangalore, India\nPosted 3 days ago\nEasy Apply"`
- Salary buried in prose: `"compensation between fifteen and twenty lakhs per annum"`
- Descriptions are HTML fragments, truncated, or sometimes empty
- Manual regex parsing fails unpredictably across different sources
- Two separate queues (scraping → scoring) create stuck jobs, operational overhead

**Autofill Quality**
- Linear execution — no real agent loop, no page awareness
- Single injection strategy (React native setter bypass) — fails on Angular, MUI, react-select, masked inputs, rich text editors, contenteditable
- No validation after injection — system reports success even when field was not actually set
- Context for generating answers uses the *job* embedding, not the *question* being asked
- RAG corpus is only the LaTeX resume — 15-20 chunks, no behavioral stories, no career narrative
- HITL answers discarded after use, never learned from
- No multi-page form support
- No page type detection — auth walls, OTP pages, redirect pages all break the flow

**Root Cause**
The system was built scraper-first. The AI layer was bolted on after. Both need to be rebuilt with AI as the foundation, not the afterthought.

---

## 2. Target Architecture

### Job Pipeline (Current vs Target)

```
CURRENT:
Scraper → raw data → DB (status: NEW)
       → BullMQ scraping queue
       → BullMQ scoring queue
       → Gemini score call
       → DB update (status: SCORED)

Problems: Two queues, stuck jobs, manual field parsing fails,
          location/title/salary all wrong in DB.

TARGET:
Scraper → raw data
        → dedup check (in-memory hash, no DB)
        → hard knockout check (regex, no LLM)
        → description quality check
          → thin? fetch full page (HTTP, deterministic)
        → single Gemini call: refine fields + score
        → DB write (status: SCORED, all fields clean)

Wins: One queue, no stuck jobs, all fields clean and structured,
      one LLM call does the work of two systems.
```

### Autofill Agent (Current vs Target)

```
CURRENT:
User clicks autofill
→ Popup scrapes fields (shallow DOM only)
→ Sends to backend via Socket.IO
→ Backend runs linear script:
    matchStaticFields() → processCustomFields() → tailorResume()
→ Popup injects everything at once
→ No validation, no retry, no page awareness

TARGET:
User clicks autofill
→ Agent loop begins (runs until terminal state):

    SENSE:  Content script classifies current page type
    PLAN:   Backend decides action based on page type + agent state
    ACT:    Execute action (inject field / click button / wait)
    OBSERVE: Validate result (did field actually get set?)
    ADAPT:  Success → next field. Failure → try fallback strategy.
            Page changed → go back to SENSE.
            Unresolvable → HITL.

Each loop iteration handles one page or one batch of fields.
Multi-step forms handled automatically.
Every HITL resolution fed back into RAG.
```

### Communication Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND (Node.js)                        │
│              AutofillAgent State Machine                    │
│         Generates plans, answers, decisions                 │
└─────────────────┬───────────────────────────────────────────┘
                  │ Socket.IO (state changes, commands)
┌─────────────────▼───────────────────────────────────────────┐
│                 EXTENSION POPUP (React)                     │
│         UI display + relay between backend & DOM            │
│         Receives state → calls content script               │
└─────────────────┬───────────────────────────────────────────┘
                  │ chrome.tabs.sendMessage
┌─────────────────▼───────────────────────────────────────────┐
│              CONTENT SCRIPT (content.ts)                    │
│     Direct DOM access: extract fields, inject values,       │
│     detect page type, validate injection success            │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 0 — Profile Data Foundation

> **Owner:** Rishav (manual writing task)  
> **Effort:** 2–4 hours  
> **Dependency for:** Phase 3 (autofill answer quality), Phase 1 (scoring context)  
> **Priority:** CRITICAL — everything downstream is only as good as this document

### What to produce

A single file: `ProfileData.md` in the repo root.

This file is the single source of truth for everything the AI knows about you. It replaces the onboarding wizard entirely. It gets chunked, embedded, and stored in the `KnowledgeChunk` table where the RAG system retrieves from it during autofill.

### Why a Markdown file, not JSON or PDF

- Human-readable and easily editable as your situation changes
- Natural hierarchy maps directly to semantic chunk boundaries
- One `npm run db:seed:profile` command re-ingests everything
- You can version control it and see diffs when you update it

### What to write in it (10 sections)

Full template is in [Appendix A](#appendix-a--profiledatamd-template). Summary of what matters most:

| Section | Why it matters | Depth required |
|---|---|---|
| Static Facts | Direct form injection, no AI needed | Precise, comprehensive |
| Skills Self-Assessment | Scoring accuracy, skill match questions | Honest, with context |
| Work Experience Narratives | Technical challenge questions | Full story, not bullets |
| Project STAR Stories | Project description questions | Problem → Solution → Result |
| Behavioral Story Bank | Leadership, failure, conflict questions | 7+ ready-to-use stories |
| Career Narrative | Why this role/company questions | First-person, authentic |
| Company Motivations | "Why [Company]?" questions | Specific per company tier |
| Pre-answered Q&A Pairs | Exact match answers, used verbatim | 50+ pairs |

### System changes to ingest this file

**New script:** `backend/src/scripts/seed-profile-doc.ts`

```
Reads ProfileData.md
→ Parses each ## section as a chunk
→ Assigns category tag (static_facts | experience | project | 
   behavioral | career_narrative | company_motivation | qa_pair)
→ Generates embedding per chunk
→ Upserts into KnowledgeChunk table
→ Parses Section 1 (Static Facts) into UserProfile table fields
→ Parses Section 10 (Q&A Pairs) into AnswerBank table
```

**New npm script:** `npm run seed:profile` (replaces current `db:seed` profile portion)

**Cache invalidation:** After seeding, delete Redis key `candidate:rich_context` so the context rebuilds on next autofill.

### Success criteria for Phase 0

- `ProfileData.md` exists with all 10 sections non-empty
- `npm run seed:profile` runs without errors
- `KnowledgeChunk` table has 60+ entries (vs current 15-20)
- `AnswerBank` table has 50+ Q&A pairs seeded from the document
- Running the autofill test script against a sample job returns correct answers for name, email, phone, LinkedIn, GitHub without any HITL

---

## Phase 1 — Job Refinement Pipeline

> **Owner:** Rishav (backend dev)  
> **Effort:** 3–5 days  
> **Dependencies:** Phase 0 (for scoring context quality)  
> **Can parallelize with:** Phase 2  
> **Risk:** Medium — changes the core data pipeline

### The core idea

Stop treating scraped data as structured. It is not. Treat it as raw signals that an LLM turns into structured data. The LLM does refinement and scoring in one call.

### What changes

**New file: `backend/src/services/ai-engine/jobRefiner.ts`**

Responsibilities:
- Takes a `RawJobInput` (everything the scraper found)
- Pre-step: if description < 300 chars, fetch full page (deterministic HTTP call, no LLM)
- Pre-step: description quality assessment (garbage/thin/good) — if garbage, discard before LLM
- Pre-step: hard knockout checks (salary regex, YOE regex) — if knocked out, skip LLM
- Single Gemini call with a two-phase prompt structure:
  - Phase A (refinement): Clean title, clean location, extract salary, summarize description
  - Phase B (scoring): Score the cleaned data against candidate profile
- Returns `RefinedJobOutput` — clean fields + fit score + fit analysis, ready for DB insert

**Why one Gemini call instead of two:**
Two passes would give cleaner separation of concerns but double API calls. The compromise is a structured prompt with explicit sequential reasoning: "First clean the data. Using the cleaned data, now score it." The model outputs both in one JSON object.

**Modified: `backend/src/services/scrapers/index.ts`**

`persistListings()` function changes:
- Remove: manual title/location/salary parsing
- Add: call `jobRefiner.refineAndScoreJob(rawListing)` before DB insert
- Add: if refiner returns null (garbage or hard knockout), skip insert entirely
- Change: job inserts with `status: 'SCORED'` directly (not `NEW`)

**Modified: `backend/src/jobs/queues.ts`**

Scoring worker becomes a rescue/rescore tool only:
- Main pipeline no longer uses the scoring queue for fresh jobs
- Scoring queue handles: manual rescore requests, failed refinement retries, re-scoring after profile update
- Scraping worker still exists but is simpler — it runs scrapers and calls refiner inline

**Modified: `backend/src/jobs/scheduler.ts`**

No structural change, just simpler — one queue instead of two to monitor.

### The Gemini prompt structure for refinement + scoring

```
System context: candidate profile (from candidateContext.ts, ~2000 tokens)
Calibration context: last 10 approved/skipped signals

Task A — Data Refinement:
  Input: raw title, raw location, raw salary, raw description (pre-fetched)
  Output fields: cleanTitle, cleanLocation, isRemote, salaryMin, salaryMax, 
                 salaryRaw, salaryType, cleanDescription

Task B — Fit Scoring (uses Task A output):
  Input: cleaned data from Task A + candidate profile
  Output fields: dimensions{}, verdict, strengths[], gaps[], reasons[],
                 whyApply, whySkip, keywordsMatched[], recommendation,
                 redFlags[], jdStructured{}

Return: Single JSON object with all fields from both tasks.
```

The model reasons about Task A first (data is in the prompt), then scores using its own cleaned output. This works because the JSON output schema forces sequential completion.

### New file: `backend/src/services/ai-engine/candidateContext.ts`

Builds the rich candidate context string used in both scoring and autofill. Reads from:
- `UserProfile` table (basic info, LaTeX resume, skills, profileJson)
- `KnowledgeChunk` table (all profile chunks — experience, projects, behavioral stories)
- `Settings` table (salary expectations, target companies)

Output: structured text ~2000 tokens, cached in Redis for 30 minutes with key `candidate:rich_context`. Invalidated after profile updates or seed.

This replaces the current `buildProfileText()` and `formatProfileJsonToText()` functions in `scorer.ts`.

### Batching for rate limits

Three jobs per Gemini call using a single prompt with three job descriptions. Same rate limit handling as current batch scorer. Workers process in chunks of 3.

### What stays the same

- All scraper implementations (adzuna.ts, linkedin.ts, naukri.ts, etc.)
- Dedup logic (SHA256 hash, URL uniqueness)
- Circuit breaker (scraperHealth.ts)
- BullMQ infrastructure
- Feedback learning loop (feedback.ts)
- The scoring queue as a rescue mechanism

### What goes away

- Separate `NEW → SCORING → SCORED` status progression for fresh jobs
- `scoreJobsBatch()` being called from the scraping worker
- Manual salary parsing regex in scrapers
- Location cleaning per-scraper heuristics

### Rollback plan

The old `persistListings()` and `scoreJobsBatch()` remain intact but are not called by the main pipeline. If the refiner has issues, one flag in config switches back to the old flow.

### Success criteria for Phase 1

- 100% of job titles in DB are clean (no posting dates, urgency markers, YOE in title)
- 100% of locations are clean (no "Posted X days ago", no timestamps)
- Salary extracted correctly for jobs where it was buried in description text
- Zero jobs stuck in `SCORING` status after 30 minutes
- DB seeding flow completes: raw scrape → SCORED in a single queue pass
- `fitAnalysis.jdStructured` populated for 90%+ of scored jobs

---

## Phase 2 — Content Script Rewrite

> **Owner:** Rishav (extension dev)  
> **Effort:** 4–6 days  
> **Dependencies:** None (standalone)  
> **Can parallelize with:** Phase 1  
> **Risk:** High — this is where most autofill failures happen

### The core idea

The content script is the only piece of the system with direct DOM access. Everything it does must be robust, multi-strategy, and properly validated. Current implementation does shallow scraping and one injection strategy. Target implementation handles every realistic form configuration.

### Part A — Field Extraction Rewrite

**Current approach:** `querySelectorAll('input, textarea, select')` → basic label lookup

**Target approach:** Multi-strategy extraction with rich metadata per field

**What to extract per field:**
```typescript
interface ExtractedField {
  id: string                    // stable identifier (prefer: id attr, then generated)
  selector: string              // primary CSS selector to re-find this element
  selectorFallbacks: string[]   // [data-testid, name attr, aria-label based, nth-child]
  elementTag: string            // input | textarea | select | div
  inputType: string             // text | email | tel | file | date | radio | checkbox | ...
  name: string                  // name attribute
  placeholder: string           // placeholder attribute
  ariaLabel: string             // aria-label or aria-labelledby resolved
  labelText: string             // resolved <label> text (see 6-strategy resolution below)
  contextHtml: string           // up to 400 chars of ancestor HTML (for AI to understand)
  required: boolean             // required attr OR aria-required OR parent has .required class
  options: string[]             // for <select> and radio groups
  currentValue: string          // current DOM value (detect pre-filled fields)
  isVisible: boolean            // not display:none, not hidden, has dimensions
  isDisabled: boolean           // disabled attr or aria-disabled
  isInShadowDom: boolean        // detected via host element traversal
  shadowHost: string            // selector of shadow host if applicable
  autocomplete: string          // autocomplete attribute (strong signal for intent)
  maxLength: number             // maxlength attribute
  acceptTypes: string           // file input accept attribute
  formAction: string            // parent form action URL
  dataTestId: string            // data-testid attribute (useful fallback selector)
  detectedFramework: string     // react | angular | vue | plain | unknown
  isCustomComponent: boolean    // react-select, MUI, Ant Design, etc.
}
```

**6-strategy label resolution (in priority order):**
1. `aria-label` attribute on the element itself
2. `aria-labelledby` → find referenced element → extract its text
3. `<label for="id">` binding
4. Closest ancestor `<label>` element
5. Previous sibling or parent's previous sibling text content
6. `placeholder` attribute → `name` attribute (last resort)

**Shadow DOM traversal:**
```
document.querySelectorAll('*')
→ for each element with shadowRoot
  → recurse into shadowRoot
  → extract fields with isInShadowDom: true
  → shadowHost selector stored for injection targeting
```

**Custom component detection:**
Check for: `.react-select__control`, `[class*="MuiSelect"]`, `[class*="ant-select"]`, `[class*="vs__"]` (Vue Select), `[data-headlessui-state]` (Headless UI). If detected, mark as `isCustomComponent: true` and set appropriate injection strategy.

**Page type detection:**
```typescript
function classifyPage(): PageType {
  // Check URL patterns
  // Check for password fields (login)
  // Check for OTP input patterns
  // Check for file upload fields (application form)
  // Check for confirmation text patterns
  // Check for progress indicators (multi-step)
  
  return 'login' | 'otp' | 'magic_link_wait' | 
         'application_form' | 'multi_step_form' |
         'confirmation' | 'redirect' | 'unknown'
}
```

### Part B — Injection Strategy Implementation

**Strategy list (in typical fallback order):**

| Strategy | When to use | How it works |
|---|---|---|
| `NATIVE_SETTER` | React-controlled inputs | `Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val)` + dispatch input + change events |
| `DIRECT_VALUE` | Plain HTML inputs | `el.value = val` + dispatch change |
| `EXEC_COMMAND` | Legacy rich text | `document.execCommand('insertText', false, val)` after focus + select all |
| `CONTENTEDITABLE` | contenteditable divs | Focus → select all → execCommand or insertText via InputEvent |
| `CUSTOM_DROPDOWN` | react-select, MUI Select | Click control → type in search → click matching option |
| `SELECT_NATIVE` | Native `<select>` | Set `.value` → dispatch change event |
| `RADIO_CLICK` | Radio button groups | Find option matching value → `.click()` |
| `CHECKBOX_CLICK` | Checkboxes | Compare current state → `.click()` if needed |
| `FILE_DATATRANSFER` | File inputs | Fetch PDF → create File object → DataTransfer → set `.files` |
| `DATE_PICKER` | Date inputs | Format value as YYYY-MM-DD → NATIVE_SETTER → dispatch |
| `PHONE_MASKED` | Masked phone fields | Focus → simulate keypress sequence character by character |
| `KEYBOARD_SIM` | Last resort | `new KeyboardEvent` for each character in the value |
| `SHADOW_DOM` | Shadow DOM wrapped inputs | `shadowHost.shadowRoot.querySelector(...)` → apply appropriate strategy |
| `SKIP` | Disabled, hidden, EEO optional | Mark as skipped, do not attempt |

**Validation after injection:**

Every injection is followed by a validation read-back:
```typescript
async function validateField(selector: string, expectedValue: string): ValidationResult {
  const el = findElement(selector)
  const actualValue = el.value || el.textContent || el.getAttribute('value')
  
  return {
    success: normalize(actualValue) === normalize(expectedValue),
    actualValue,
    expectedValue,
    divergence: editDistance(actualValue, expectedValue)
  }
}
```

Validation runs 100ms after injection to allow React state to settle. If validation fails, the field is marked for retry with the next strategy in the fallback list.

**Per-field injection loop:**
```
for each field in injectionPlan:
  for each strategy in field.strategies:
    attempt injection with strategy
    wait 100ms
    validate result
    if success: break, mark field DONE
    if fail: try next strategy
  if all strategies exhausted: mark field FAILED (→ HITL)
```

### Part C — New Message Protocol

New messages the popup can send to content script:

```typescript
// Classify current page
{ action: 'page:classify' }
→ response: { pageType: PageType, url: string, confidence: number }

// Extract all form fields
{ action: 'fields:extract' }
→ response: { fields: ExtractedField[], formAction: string, isMultiStep: boolean, stepInfo: { current, total } }

// Inject a single field (backend decides strategy order)
{ action: 'field:inject', fieldId: string, value: string, strategies: InjectionStrategy[] }
→ response: { success: boolean, strategy: string, validated: boolean, actualValue: string }

// Validate current field values (called by backend to check state)
{ action: 'fields:validate', fieldIds: string[] }
→ response: { results: Record<fieldId, { value: string, empty: boolean }> }

// Observe page state (check for navigation, errors, confirmation)
{ action: 'page:observe' }
→ response: { urlChanged: boolean, newUrl: string, confirmationDetected: boolean, errorDetected: boolean, errorText: string }

// Upload file to file input
{ action: 'field:upload', fieldId: string, fileUrl: string, filename: string }
→ response: { success: boolean }

// Click a button (for Next Step, Submit, etc.)
{ action: 'dom:click', selector: string }
→ response: { success: boolean, pageChanged: boolean }
```

### What stays the same

- Background service worker (`background.ts`) — Gmail OTP, job detection
- Manifest V3 structure
- Side panel configuration
- The `__jh` URL parameter propagation logic

### Success criteria for Phase 2

- Field extraction works on: Greenhouse, Lever, Workday, Ashby, LinkedIn Easy Apply, Naukri
- Labels correctly resolved for 95%+ of form fields in test runs
- Shadow DOM fields detected and extracted (Workday uses shadow DOM extensively)
- `react-select` dropdowns successfully injected with `CUSTOM_DROPDOWN` strategy
- Phone masked inputs successfully filled with `PHONE_MASKED` strategy
- File inputs successfully loaded with `FILE_DATATRANSFER` strategy
- Validation confirms actual DOM state matches injected values
- Page type correctly classified for login, OTP, form, confirmation pages

---

## Phase 3 — Autofill Agent State Machine

> **Owner:** Rishav (backend + extension integration)  
> **Effort:** 6–8 days  
> **Dependencies:** Phase 2 (content script), Phase 0 (profile data)  
> **Risk:** High — most complex component  

### The core idea

Replace the linear `execute()` method with a state machine that loops until terminal state. The machine senses page state, plans actions, executes them via the content script relay, observes results, and adapts. Multi-step forms, auth walls, OTP pages, and confirmation pages are handled automatically within the same loop.

### State machine definition

```
States (19):
  IDLE
  PAGE_DETECT           ← sense: what kind of page is this right now?
  
  -- Auth handling --
  AUTH_DETECT           ← login form found, check for saved credentials
  AUTH_FILL             ← injecting credentials
  AUTH_SUBMIT           ← clicking login button
  OTP_WAIT              ← OTP page, polling Gmail for code
  MAGIC_LINK_WAIT       ← waiting for verification email, polling Gmail
  
  -- Form handling --
  FIELDS_EXTRACT        ← content script scraping current page fields
  FIELDS_ANALYZE        ← AI classifying field intent + injection strategy
  CONTEXT_BUILD         ← loading candidate context + RAG retrieval per field
  ANSWERS_GENERATE      ← AI generating answers for non-static fields
  RESUME_COMPILE        ← compiling tailored PDF (only if file field detected)
  INJECT_PLAN           ← ordering injection tasks
  INJECT_EXECUTE        ← injecting fields one by one
  INJECT_VALIDATE       ← checking which fields actually got set
  INJECT_RETRY          ← trying fallback strategies for failed fields
  
  -- Human loop --
  HITL_REQUIRED         ← unresolvable fields sent to user
  
  -- Transitions --
  PAGE_OBSERVE          ← checking if page changed after injection/submit
  NEXT_STEP             ← clicking "Next" button in multi-step form
  
  -- Terminal --
  COMPLETED
  FAILED

Transitions (examples):
  IDLE → PAGE_DETECT                (user clicks Start)
  PAGE_DETECT → FIELDS_EXTRACT      (form page detected)
  PAGE_DETECT → AUTH_DETECT         (login page detected)
  PAGE_DETECT → OTP_WAIT            (OTP page detected)
  PAGE_DETECT → MAGIC_LINK_WAIT     (magic link wait page)
  PAGE_DETECT → PAGE_OBSERVE        (redirect/unknown page)
  AUTH_FILL → AUTH_SUBMIT           (credentials injected)
  AUTH_SUBMIT → PAGE_DETECT         (after submit, re-classify)
  OTP_WAIT → PAGE_DETECT            (OTP filled, re-classify)
  FIELDS_EXTRACT → FIELDS_ANALYZE   (fields received)
  FIELDS_ANALYZE → CONTEXT_BUILD    (classification done)
  CONTEXT_BUILD → ANSWERS_GENERATE  (context assembled)
  ANSWERS_GENERATE → RESUME_COMPILE (if file field exists, not yet compiled)
  ANSWERS_GENERATE → INJECT_PLAN    (if no file field needed)
  RESUME_COMPILE → INJECT_PLAN      (PDF ready)
  INJECT_PLAN → INJECT_EXECUTE      (plan ready)
  INJECT_EXECUTE → INJECT_VALIDATE  (all injections attempted)
  INJECT_VALIDATE → PAGE_OBSERVE    (all fields OK)
  INJECT_VALIDATE → INJECT_RETRY    (some fields failed)
  INJECT_VALIDATE → HITL_REQUIRED   (some fields unresolvable)
  INJECT_RETRY → INJECT_VALIDATE    (after retry attempt)
  INJECT_RETRY → HITL_REQUIRED      (retry exhausted)
  HITL_REQUIRED → INJECT_EXECUTE    (user provided answers)
  PAGE_OBSERVE → NEXT_STEP          (multi-step: more steps remain)
  PAGE_OBSERVE → PAGE_DETECT        (URL changed, re-classify new page)
  PAGE_OBSERVE → COMPLETED          (confirmation text detected)
  PAGE_OBSERVE → FAILED             (error page detected)
  NEXT_STEP → FIELDS_EXTRACT        (next step loaded, extract new fields)
```

### Agent state object (what gets persisted to Redis)

```typescript
interface AgentRunState {
  // Identity
  runId: string
  jobId: string
  socketId: string
  
  // Current state
  state: AgentStateName
  previousState: AgentStateName
  
  // Job context (loaded once)
  jobTitle: string
  companyName: string
  jobDescription: string
  
  // Form tracking
  allFields: FieldAnalysis[]           // all fields seen across all steps
  currentStepFields: FieldAnalysis[]   // fields visible on current step
  answers: Record<string, string>      // fieldId → generated/resolved answer
  injectionResults: Record<string, {   // fieldId → injection result
    strategy: string
    validated: boolean
    attempts: number
  }>
  
  // Resume
  resumeCompiled: boolean
  tailoredResumeUrl: string | null
  
  // HITL tracking
  unresolvedFields: FieldAnalysis[]    // fields needing human input
  
  // Multi-step tracking
  currentStep: number
  totalSteps: number | null
  completedSteps: number[]
  
  // Auth tracking
  authAttempted: boolean
  authDomain: string | null
  
  // Loop control
  loopCount: number                    // prevent infinite loops
  maxLoops: number                     // hard limit (default: 20)
  lastPageUrl: string
  
  // Status
  progressMessage: string
  errorMessage: string | null
  
  // Timestamps
  startedAt: number
  lastUpdatedAt: number
}
```

### Answer generation — the RAG redesign

**Current (wrong):** Retrieve chunks using the job embedding → context is about the job.

**Target (correct):** Retrieve chunks using the question embedding → context is about the candidate's relevant experience for that question.

```
For each unanswered field:
  1. Classify question type from field.intent
  
  2. If STATIC intent (name, email, phone, etc.):
     → Look up directly in candidateContext.staticFields
     → No retrieval needed, no LLM needed
  
  3. If KNOWN intent with pre-answered Q&A:
     → Check AnswerBank with semantic similarity on question text
     → If similarity > 0.90 and answer is high quality: use verbatim
     → No LLM needed
  
  4. If NARRATIVE intent (behavioral, motivation, project, etc.):
     → Generate query from field.normalizedLabel + field.intent
     → pgvector search against KnowledgeChunk using question embedding
       (not job embedding — this is the key change)
     → Retrieve top 5 chunks filtered by relevant category:
         behavioral question → category IN (behavioral, experience, project)
         project question → category IN (project, experience, technical_strength)  
         motivation question → category IN (career_narrative, company_motivation)
         technical question → category IN (experience, technical_strength, project)
     → Build answer using retrieved context + candidateContext.fullText section
     → LLM generates answer, max length from field.responseMaxLength
  
  5. If UNKNOWN / CUSTOM_QUESTION:
     → Broad retrieval across all categories
     → LLM generates answer with full candidate context
     → If answer confidence low → mark for HITL
```

**Batch answer generation:**
All fields that need LLM answers are sent in one batch call (same approach as current `processCustomFields()`). The retrieval per-field is the new part — each field gets its own relevant chunks before the batch prompt is built.

### HITL — what triggers it and what doesn't

**Never needs HITL (resolve automatically):**
- Name, email, phone, location, LinkedIn, GitHub (static lookup)
- Notice period, work authorization, willing to relocate (pre-configured)
- Expected salary (pre-configured with salary expectations)
- Total experience, graduation year, university, CGPA (static lookup)
- Standard behavioral questions with matching story in AnswerBank (similarity > 0.90)
- Technical questions about projects/experience in RAG corpus (similarity > 0.75)
- How did you hear about us, referral source (pre-configured default)
- EEO questions (pre-configured: prefer not to answer, or specific configured answers)

**Triggers HITL (genuinely unknowable):**
- Company-specific questions not in AnswerBank and similarity score < 0.70
- Specific personal preference questions (preferred office location at this company, shift preference)
- Real-time context questions ("what is your current project deadline")
- Fields where all injection strategies failed validation

**After HITL resolution:**
- User-provided answer stored in AnswerBank with question embedding
- Tagged with company name for company-specific questions
- Agent resumes from INJECT_EXECUTE with the resolved answers

### New file: `backend/src/services/ai-engine/autofillAgent.ts`

Replaces `autofillGraph.ts`. Keeps the same external interface so `socket.ts` doesn't change much:
- `AutofillAgent` class (replaces `AutofillGraphExecutor`)
- Same Socket.IO events: `autofill:start`, `autofill:hitl-resolve`
- Same state change emissions: `autofill:state-change`, `autofill:error`

Internal changes: everything. State machine replaces linear execution. Full loop logic. Better context building. Per-field RAG retrieval.

### New file: `backend/src/services/ai-engine/formAnalyzer.ts`

Two-pass field classification:
- Pass 1: Heuristic classification (regex on label/name/placeholder/autocomplete) — fast, no LLM
- Pass 2: Gemini structured output for low-confidence fields and custom questions

Returns enriched `FieldAnalysis` with: `intent`, `confidence`, `injectionStrategy`, `injectionFallbacks`, `normalizedLabel`, `responseMaxLength`.

### Socket.IO event changes

**Backend → Popup (new/changed):**
```
autofill:state-change  { state, progressMessage, fields?, answers?, unresolvedFields? }
  → state now has 19 values instead of 5
  → popup must handle all states gracefully

autofill:inject-field  { fieldId, value, strategies[] }
  → NEW: backend asks popup to inject a specific field
  → popup relays to content script
  → popup sends back autofill:inject-result

autofill:click         { selector, waitForNavigation: boolean }
  → NEW: backend asks popup to click a DOM element (Next button, Submit)
  → popup relays to content script
```

**Popup → Backend (new/changed):**
```
autofill:start         { jobId, pageUrl }
  → CHANGED: popup no longer sends pre-scraped fields
  → backend now drives field extraction via commands

autofill:hitl-resolve  { jobId, answers: Record<fieldId, string> }
  → unchanged

autofill:page-info     { pageType, url, fields?, formAction? }
  → NEW: popup sends page classification result to backend
  → triggered when backend emits autofill:classify-page command

autofill:inject-result { fieldId, success, strategy, validated, actualValue }
  → NEW: result of injection attempt
```

### Success criteria for Phase 3

- Full application completed on Greenhouse form without any manual intervention
- Full application completed on Lever form without any manual intervention
- Multi-step forms handled automatically (Workday wizard style)
- Auth page detected and bypassed using stored credentials
- OTP filled automatically via Gmail integration
- HITL triggered for fewer than 2 fields on average per application
- Every HITL resolution stored back into AnswerBank
- Agent correctly detects confirmation page and marks job as APPLIED
- No infinite loops — `maxLoops` guard works

---

## Phase 4 — Learning Loop

> **Owner:** Rishav  
> **Effort:** 2–3 days  
> **Dependencies:** Phase 3  
> **Can parallelize with:** Phase 5  

### The core idea

Every interaction teaches the system. Every HITL resolution, every application completed, every answer generated — these feed back into the RAG so the system gets better with each use.

### What already works (keep as-is)

- `recordApproval()` / `recordSkip()` → Redis capped lists → feedback calibration in scoring
- `getFeedbackCalibration()` → injected into scoring prompts
- `checkScoreDrift()` → detects if scoring model is miscalibrated
- `recalibrateWeights()` → adaptive weight adjustment
- `saveAnswerToBank()` → called after HITL resolution, stores Q&A pairs
- `lookupCachedAnswer()` → semantic search against AnswerBank before calling LLM

### What to add

**Answer quality rating (Post-application review):**

After each application is completed, the popup shows a review screen with all injected answers. User can mark each answer as: `GOOD` | `NEEDS_IMPROVEMENT` | `WRONG`.

- `GOOD` answers: their AnswerBank entry gets a `confidence_boost` flag — used preferentially in future lookups
- `NEEDS_IMPROVEMENT`: entry flagged for manual editing, not used verbatim next time
- `WRONG`: entry soft-deleted (marked inactive), new HITL triggered next time this question appears

**Cross-application answer consolidation:**

Cron job runs weekly. Finds AnswerBank entries that:
1. Have been used 3+ times without complaints
2. Have semantic similarity > 0.85 to each other

Promotes the best version into a "canonical answer" for that question type. Lower-quality duplicates soft-deleted.

**Profile auto-update from completed applications:**

After completing an application:
- Track which fields were HITL (system didn't know)
- If same HITL question appears 3+ times, flag it for addition to `ProfileData.md`
- Surface this flag in the dashboard: "You've been asked X question 3 times. Consider adding it to your profile document."

**New API endpoint:**

`POST /api/applications/:id/answer-ratings`
```json
{ 
  "ratings": [
    { "fieldId": "field-why-company", "rating": "GOOD" },
    { "fieldId": "field-salary", "rating": "NEEDS_IMPROVEMENT" }
  ]
}
```

### Success criteria for Phase 4

- AnswerBank grows automatically — 50+ entries after 5 applications without any manual seeding
- Same question answered correctly in future without HITL (if answered correctly once before)
- Dashboard shows "frequently asked questions not in your profile" suggestions
- Answer quality improves measurably — HITL rate decreases over successive applications on the same ATS platform

---

## Phase 5 — Frontend & Extension Polish

> **Owner:** Rishav  
> **Effort:** 2–3 days  
> **Dependencies:** Phases 3 and 4  
> **Risk:** Low — UI only  

### Extension popup (App.tsx) changes

**New state screens for all 19 agent states:**

| Agent State | UI to show |
|---|---|
| `PAGE_DETECT` | "Analyzing current page..." with spinner |
| `AUTH_DETECT` | "Login page detected" with credential form if no saved creds |
| `OTP_WAIT` | "OTP page detected — checking Gmail..." with countdown |
| `MAGIC_LINK_WAIT` | "Checking Gmail for verification link..." |
| `FIELDS_EXTRACT` | "Scanning form — found N fields so far..." |
| `FIELDS_ANALYZE` | "AI classifying N form fields..." |
| `CONTEXT_BUILD` | "Loading your profile context..." |
| `ANSWERS_GENERATE` | "Generating answers for N fields..." with progress bar |
| `RESUME_COMPILE` | "Tailoring and compiling resume PDF..." |
| `INJECT_EXECUTE` | Per-field progress: "Filling: Full Name ✓ Email ✓ Phone..." |
| `INJECT_VALIDATE` | "Verifying N fields were set correctly..." |
| `INJECT_RETRY` | "Retrying 2 fields with alternative strategies..." |
| `HITL_REQUIRED` | Full HITL form (existing, improve UI) |
| `PAGE_OBSERVE` | "Checking page state..." |
| `NEXT_STEP` | "Moving to step N..." |
| `COMPLETED` | Celebration screen + answer review form |
| `FAILED` | Error screen with specific error + what to do |

**Injection preview before committing:**

Current: popup injects everything at once.
Target: popup shows a review screen → user can edit any answer → then confirms → injection begins.

This already exists in the current `preview` state but needs to be improved:
- Show field label + generated answer side by side
- Edit in-place (textarea for long answers, input for short)
- Confidence badge per field (from AI classification)
- Mark as HITL manually if user wants to override

**Per-field injection progress visualization:**

As injection happens field by field, the popup updates in real time:
```
✓ Full Name
✓ Email  
✓ Phone
↻ LinkedIn (retrying — first strategy failed)
✓ LinkedIn
⧖ Resume PDF (uploading...)
✓ Resume PDF
✗ Why this company (HITL required — low confidence)
```

**Post-application review screen:**

After `COMPLETED`:
- List all injected answers with field labels
- Thumbs up / thumbs down per answer
- "Open Job Listing" button
- "Mark as Applied" confirms → calls `/api/jobs/:id/status` with `APPLIED`
- Download PDF button

### Dashboard changes

**Job queue view improvements:**
- Show `jdStructured.mustHaveSkills` as tags on each job card
- Show `jdStructured.requiredYoe` as a badge
- Color-code salary: green (confirmed high), amber (estimated), grey (unknown)
- Filter by `descriptionQuality` (to find jobs needing manual review)

**New page: "Profile Health"**
- Shows which sections of `ProfileData.md` are populated
- Shows KnowledgeChunk count by category
- Shows AnswerBank entry count
- Shows "frequently asked but unanswered" questions
- Button to re-run `seed:profile` after editing ProfileData.md
- Shows when RAG context was last built (Redis cache timestamp)

**Settings improvements:**
- Show current dimension weights as a bar chart (not just numbers)
- Show drift warning prominently if `scoring:drift_warning` key exists in Redis
- Add "Reset scoring weights to defaults" button

### Success criteria for Phase 5

- All 19 agent states have a corresponding UI screen (no blank/spinner fallthrough)
- Per-field injection progress visible in real time
- Post-application review screen works and ratings get saved
- "Profile Health" dashboard page shows accurate stats
- Zero states where user sees a blank popup or frozen UI

---

## Execution Order & Dependencies

```
Phase 0 (YOU)          → Start immediately, no dependencies
                          2–4 hours of writing

Phase 1 (Backend)      → Start after Phase 0 is drafted (scoring context)
Phase 2 (Extension)    → Start in parallel with Phase 1, no shared deps

Phase 3 (Agent)        → Start after BOTH Phase 0 and Phase 2 are done
                          Phase 0 provides the RAG data
                          Phase 2 provides the injection primitives

Phase 4 (Learning)     → Start after Phase 3 is working
                          Can overlap with Phase 5

Phase 5 (Polish)       → Start after Phase 3 is working
                          Can overlap with Phase 4

Timeline (rough):
Week 1:  Phase 0 (writing) + Phase 1 (backend pipeline)
Week 2:  Phase 2 (content script) + Phase 1 testing
Week 3:  Phase 3 (agent) — the big one
Week 4:  Phase 3 testing + Phase 4 + Phase 5
```

---

## Success Criteria

### Overall system success metrics

| Metric | Current | Target |
|---|---|---|
| Job title accuracy (no noise) | ~40% | 99% |
| Salary extraction accuracy | ~30% | 85% |
| Location field accuracy | ~50% | 99% |
| Time from scrape → SCORED | ~10-15 min (two queues) | ~30-60 sec (inline) |
| Autofill HITL rate | ~60% of fields | <15% of fields |
| Fields correctly injected (validated) | ~50% | 90%+ |
| Multi-step form completion | 0% | 80%+ |
| Auth wall bypass rate | 0% | 70%+ (if credentials stored) |
| Confirmation detection rate | 0% | 85%+ |

---

## File Change Index

### New files to create

| File | Phase | Purpose |
|---|---|---|
| `ProfileData.md` | 0 | Candidate profile source document |
| `backend/src/scripts/seed-profile-doc.ts` | 0 | Parse and ingest ProfileData.md |
| `backend/src/services/ai-engine/jobRefiner.ts` | 1 | AI refinement + scoring pipeline |
| `backend/src/services/ai-engine/candidateContext.ts` | 1 | Rich candidate context builder |
| `backend/src/services/ai-engine/formAnalyzer.ts` | 3 | AI form field intent classifier |
| `backend/src/services/ai-engine/autofillAgent.ts` | 3 | State machine agent (replaces autofillGraph.ts) |

### Files to significantly rewrite

| File | Phase | What changes |
|---|---|---|
| `extension/src/content.ts` | 2 | Field extraction (shadow DOM, 6-strategy label), all injection strategies, validation |
| `extension/src/App.tsx` | 5 | All 19 agent states with UI |

### Files to modify (surgical changes)

| File | Phase | What changes |
|---|---|---|
| `backend/src/services/scrapers/index.ts` | 1 | `persistListings()` calls jobRefiner, jobs insert as SCORED |
| `backend/src/jobs/queues.ts` | 1 | Scoring worker becomes rescue-only, simpler scraping worker |
| `backend/src/core/socket.ts` | 3 | New autofillAgent instead of AutofillGraphExecutor |
| `backend/src/services/ai-engine/scorer.ts` | 1 | Keep for manual rescores, remove from main pipeline |
| `backend/prisma/schema.prisma` | 0 | Add `KnowledgeChunk.subcategory`, `AnswerBank.quality_rating` |

### Files that stay the same

Everything else — all scraper implementations, circuit breaker, feedback learning, Redis, Docker setup, auth, settings API, jobs API, applications API, resume compiler, cover letter generator, RAG service, answer bank service.

---

*End of Roadmap*