# 🚀 JobHunt — Automated AI Job Hunting Platform

> **Human-in-the-Loop Job Search Automation Platform**  
> Streamline your job hunt with AI-powered fit scoring, automated LinkedIn/Adzuna scraping, dynamic LaTeX resume tailoring, and a Chrome extension copilot for ATS forms.  
> **Stack:** Node.js + TypeScript · Gemini AI · Playwright · PostgreSQL + Prisma · Redis + BullMQ · Next.js 16 (React 19) · Tailwind CSS v4

---

## 🏗️ System Architecture & Workflow

The platform follows a **Human-in-the-Loop (HITL)** architecture designed to process intensive background operations (scraping, inline AI refinement) asynchronously while maintaining a real-time, dashboard-driven admin panel.

```
                   ┌───────────────────────────────────────────────┐
                   │               FRONTEND DASHBOARD              │
                   │         (Next.js 16 + Tailwind CSS v4)        │
                   │ - Profile Health & Editors - Settings & Stats  │
                   └───────────────┬───────────────────────▲───────┘
                                   │ REST (Axios)          │ WebSockets (Socket.io)
                                   ▼                       │
                   ┌───────────────────────────────────────┴───────┐
                   │             BACKEND API (Express)             │
                   │ - Jobs API   - Settings API   - Applications  │
                   └───────────────┬───────────────────────┬───────┘
                                   │ Enqueues Tasks        │ Queries / Persists
                                   ▼                       ▼
                   ┌──────────────────────────────┐┌───────────────┴───────┐
                   │    REDIS (BullMQ Queues)     ││  DATABASE (Postgres)  │
                   │ - job-scraping               ││ - Prisma Client ORM   │
                   └───────────────┬──────────────┘│ - pgvector (768-D)    │
                                   │ worker processes └────▲───────────────┘
                                   ▼                       │
                   ┌───────────────────────────────────────┴───────┐
                   │            BULLMQ BACKGROUND WORKERS          │
                   │ - Playwright Headless Scraping & Details      │
                   │ - Gemini AI Inline scoring & 768-D Embeddings │
                   └───────────────────────┬───────────────────────┘
                                           │
                                           ▼ (Real-time Copilot Link)
                   ┌───────────────────────────────────────────────┐
                   │          CHROME COPILOT EXTENSION             │
                   │            (Vite + React + CRXJS)             │
                   │ - 19-State Sense-Plan-Act Loop (in Redis)     │
                   │ - DOM Form Extraction & Auto-injection        │
                   └───────────────────────────────────────────────┘
```

### 🔄 The Application Lifecycle
1. **Scraping**: Background workers trigger scrapers (LinkedIn, Naukri, Wellfound, RemoteOK, YCombinator, Adzuna, ATS, etc.) to capture new listings.
2. **Filtering**: Deterministic filters discard irrelevant job titles and low salary ranges.
3. **Scoring**: A composite vector-similarity (768-D) and multi-dimensional Gemini AI model grades remaining jobs on a 0-100 scale inline during the scraping phase.
4. **Calibration**: Future scores self-calibrate using feedback Cap-lists containing your last 10 approved and skipped jobs.
5. **Dashboard Actions**: You review jobs, click **Tailor Resume** to rewrite your LaTeX profile dynamically, or click **Autofill** via the browser extension to complete Greenhouse/Lever forms in 1 click using the 19-state agent loop.

---

## 📁 Repository & Service Directory Structure

The repository is structured as a TypeScript monorepo with three core workspaces:

```
JobHunt/
├── backend/            # Express API server & BullMQ background worker
│   ├── prisma/         # Database schema declaration & migrations
│   └── src/
│       ├── api/        # REST Route controllers (jobs, settings, apps)
│       ├── core/       # Logger, Redis, Prisma, Socket.io & Scraper Circuit Breaker
│       ├── jobs/       # BullMQ queue & scheduler definitions
│       ├── scripts/    # Database seeding, manual requeue, and test scripts
│       ├── services/
│       │   ├── ai-engine/  # Gemini LLM wrappers, feedback logic, resume tailoring, 19-state autofill agent
│       │   └── scrapers/   # Scraper orchestrator & platform implementations
│       └── workers/    # BullMQ Worker entrypoint
├── frontend/           # Next.js 16 Web Dashboard UI
│   └── src/
│       ├── app/        # App router folders: analytics, applications, companies, dashboard, jobs, profile-health
│       ├── components/ # Shared UI items (Job Cards, App Sidebar, Shadcn UI)
│       └── lib/        # API endpoints configurations & types definitions
└── extension/          # Chrome Copilot Extension
    ├── src/
    │   ├── background.ts # Manifest V3 service worker for API request routing
    │   ├── content.ts    # React Input Trap Bypass & DOM field scraper/injector
    │   └── App.tsx       # Extension popup/sidebar UI panel
```

### 1. Backend Service Details (`backend/`)
- **[`prisma/schema.prisma`](file:///c:/Users/Lenovo/Code/JobHunt/backend/prisma/schema.prisma)**: Defines the database schema, including indexing for performance and relationships between `Job`, `Application`, `UserProfile`, `Settings`, `KnowledgeChunk` (for RAG), and `AnswerBank` (cached Q&A).
- **[`src/core/scraperHealth.ts`](file:///c:/Users/Lenovo/Code/JobHunt/backend/src/core/scraperHealth.ts)**: A Redis-backed **Circuit Breaker** protecting scrapers. Automatically trips to `OPEN` after 3 consecutive failures to skip the broken scraper, transitioning back to `CLOSED` after a 2-hour cooldown.
- **[`src/services/ai-engine/scorer.ts`](file:///c:/Users/Lenovo/Code/JobHunt/backend/src/services/ai-engine/scorer.ts)**: Computes cosine similarity of the candidate embedding vs job listing, checks deterministic cutoffs (YOE, salary), and feeds details into Gemini for multi-dimensional grading (Tech stack, Seniority, Domain, Compensation, Company tier).
- **[`src/services/ai-engine/autofillAgent.ts`](file:///c:/Users/Lenovo/Code/JobHunt/backend/src/services/ai-engine/autofillAgent.ts)**: Stateful 19-state sense-plan-act form-filling agent using RAG and previous answer banks to resolve custom application questions.

### 2. Frontend Dashboard (`frontend/`)
- Built on **React 19 + Next.js 16** with Tailwind CSS v4.
- Includes a consolidated **Profile Health** dashboard under `/profile-health`, featuring Monaco-based LaTeX and `ProfileData.md` editors alongside RAG coverage checklists.
- Includes consolidated general settings (scraper parameters and scoring simulator) alongside directories under `/companies` (Company Settings).
- **Real-time Synchronization** powered by WebSockets (`Socket.io`) updates scraping/scoring states.
- Recharts-based **Analytics Page** under `/analytics` to track application funnels, target salary statistics, and source distributions.

### 3. Chrome Extension (`extension/`)
- Uses **Vite + CRXJS Vite Plugin** for fast Hot Module Replacement (HMR) in extension development.
- **Bypasses the "React Input Trap"** (where direct JS `element.value = "val"` ignores React state tracking) by calling the native value property descriptor setter and dispatching bubble events.

---

## ⚙️ Environment Variables (`.env`)

Create a `.env` file in the root directory. Copy and fill out these keys:

```ini
# Required: Gemini API Key (from Google AI Studio)
GEMINI_API_KEY=your_gemini_api_key_here

# Job Scrapers Config
ADZUNA_APP_ID=your_adzuna_app_id
ADZUNA_API_KEY=your_adzuna_api_key
SERPER_API_KEY=your_optional_serper_key_here

# Security & Secrets
DASHBOARD_PASSWORD=your_secure_admin_password
JWT_SECRET=random_hex_secret_string

# Database & Cache Locations
DATABASE_URL=postgresql://jobhunt:jobhunt_secret@localhost:5433/jobhunt
REDIS_URL=redis://localhost:6379

# Network Details
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000
STORAGE_PATH=./storage
```

---

## 🐳 Running with Containerization (Docker)

To start the database, cache, backend server, BullMQ workers, and the frontend server together:

### 1. Docker Compose (Development with Watch Mode)
This mode maps your local directory code using Docker volumes, runs development start scripts, and uses Compose Watch for real-time syncing of file changes:

```bash
docker compose watch
```
*(Alternatively, run `docker compose up --watch` or use the root monorepo shortcut `npm run docker:watch` to start the containers and immediately begin watching for file changes).*

### 2. Individual Docker Containers
You can build and run individual services separately (make sure to set correct environment variables like `DATABASE_URL` and `REDIS_URL` to point to your database and Redis hosts):

* **Development Mode**:
  Build the dev stages:
  ```bash
  docker build --target development -t jobhunt-backend ./backend
  docker build --target development -t jobhunt-frontend ./frontend
  ```
  Run backend container:
  ```bash
  docker run -d --name jobhunt-backend-dev -p 4000:4000 \
    -e DATABASE_URL="postgresql://jobhunt:jobhunt_secret@host.docker.internal:5433/jobhunt" \
    -e REDIS_URL="redis://host.docker.internal:6379" \
    -e GEMINI_API_KEY="your_api_key_here" \
    jobhunt-backend
  ```
  Run frontend container:
  ```bash
  docker run -d --name jobhunt-frontend-dev -p 3000:3000 \
    -e NODE_ENV="development" \
    -e BACKEND_INTERNAL_URL="http://host.docker.internal:4000" \
    jobhunt-frontend
  ```

* **Production Mode**:
  Build the production stages:
  ```bash
  docker build --target production -t jobhunt-backend ./backend
  docker build --target production -t jobhunt-frontend ./frontend
  ```
  Run backend container:
  ```bash
  docker run -d --name jobhunt-backend-prod -p 4000:4000 \
    -e DATABASE_URL="postgresql://jobhunt:jobhunt_secret@host.docker.internal:5433/jobhunt" \
    -e REDIS_URL="redis://host.docker.internal:6379" \
    -e GEMINI_API_KEY="your_api_key_here" \
    jobhunt-backend
  ```
  Run frontend container:
  ```bash
  docker run -d --name jobhunt-frontend-prod -p 3000:3000 \
    -e NODE_ENV="production" \
    -e BACKEND_INTERNAL_URL="http://host.docker.internal:4000" \
    jobhunt-frontend
  ```

---

## 💻 Running Without Containerization (Bare-Metal)

For local development or hosting without Docker, you will need Node.js (v20+) and local PostgreSQL + Redis running.

### 1. Unified Monorepo Installation (Root Workspaces)
To install dependencies for the backend, frontend, and extension with one command:
```bash
npm run install:all
```

### 2. Set Up Database Schema
Apply migrations or push the schema definitions directly:
```bash
npm run db:push
```

### 3. Seed Database Profile & LaTeX Chunks
```bash
npm run db:seed
```

### 4. Running the application

* **Development Mode (Concurrently starts dev servers with watch mode)**:
  ```bash
  npm run dev
  ```
  The services will start with the following endpoints:
  - **API Server**: http://localhost:4000
  - **Frontend Dashboard**: http://localhost:3000
  - **Chrome Extension Builder**: Dev server running on http://localhost:5173

* **Production Mode**:
  Compile all applications to JavaScript/production bundles:
  ```bash
  npm run build:all
  ```
  Once compiled, run the production servers concurrently:
  ```bash
  npm run start:all
  ```
  Alternatively, start each service individually:
  ```bash
  # Start Backend API
  node backend/dist/index.js

  # Start BullMQ worker
  node backend/dist/workers/worker.js

  # Start Next.js App
  npm start --prefix frontend
  ```

---

## 🗺️ Roadmap & Current Status

- [x] **Phase 1**: Automated Scraping (LinkedIn, Naukri, Wellfound, YCombinator, RemoteOK, Adzuna)
- [x] **Phase 2**: Dual-pass AI Scoring (Semantic Embedding + CoT Gemini analysis)
- [x] **Phase 3**: Resume Tailoring (LaTeX updates in-app via Gemini Pro)
- [x] **Phase 4**: Automated Form Filling Chrome Copilot Extension
- [ ] **Phase 5**: Gmail Tracking & Sentiment Analysis (Email watch integration)
