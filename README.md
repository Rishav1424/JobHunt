# JobHunt — Automated AI Job Hunting Platform

> Personal job hunting automation for **Rishav Sharma** (NIT Durgapur '26)  
> Stack: Node.js + TypeScript · Gemini AI · Playwright · PostgreSQL · Redis · Next.js

---

## 🚀 Quick Start (5 steps)

### 1. Copy and fill your environment file
```bash
copy .env.example .env
```
Edit `.env` and add at minimum:
- `GEMINI_API_KEY` — from [Google AI Studio](https://aistudio.google.com/app/apikey) (free)
- `ADZUNA_APP_ID` + `ADZUNA_API_KEY` — from [developer.adzuna.com](https://developer.adzuna.com) (free)

### 2. Start infrastructure (PostgreSQL + Redis)
```bash
docker-compose up postgres redis -d
```

### 3. Initialize database
```bash
cd backend
npm run db:push
npm run db:seed
```

### 4. Start backend (API + Worker in separate terminals)
```bash
# Terminal 1 — API server
cd backend
npm run dev

# Terminal 2 — BullMQ worker
cd backend
npm run dev:worker
```

### 5. Start frontend
```bash
cd frontend
npm run dev
```

**Dashboard**: http://localhost:3000  
**API**: http://localhost:4000  
**Queue Monitor**: http://localhost:3001 (Bull Board)

---

## 🏗️ Architecture

```
frontend/   → Next.js 14 dashboard (review mode UI)
backend/    → Express API + Socket.IO + BullMQ workers
  ├── scrapers/    → Adzuna, RemoteOK, Wellfound, InstaHyre, LinkedIn
  ├── ai-engine/   → Gemini Flash (scoring) + Pro (tailoring)
  └── automation/  → Playwright apply engine (Phase 4)
```

## 📋 Review Mode Flow

```
1. Scrapers run every 6h → new jobs in DB
2. Gemini scores each job (0-100) against your resume
3. Dashboard shows scored jobs → you approve/skip
4. Click "Tailor Resume" → Gemini Pro rewrites your .latex
5. Click "Cover Letter" → Gemini Flash generates one
6. Click "Approve & Apply" → Playwright fills form
7. You confirm submit → screenshot saved → status tracked
```

## 🤖 Gemini AI Usage

| Task | Model | Cost |
|---|---|---|
| Fit scoring | `gemini-1.5-flash` | ~free on free tier |
| Resume tailoring | `gemini-1.5-pro` | ~$0.10-0.20/resume |
| Cover letter | `gemini-1.5-flash` | ~free |
| Embeddings | `text-embedding-004` | free |

## 📁 Key Files

| File | Purpose |
|---|---|
| `BaseResume.latex` | Your base resume — auto-loaded on seed |
| `backend/prisma/schema.prisma` | Database schema |
| `backend/src/core/gemini.ts` | Gemini client (Flash + Pro + Embeddings) |
| `backend/src/services/scrapers/` | All job scrapers |
| `backend/src/services/ai-engine/` | Scoring + tailoring |
| `frontend/src/app/(app)/` | All dashboard pages |

## 🗺️ Roadmap

- ✅ **Phase 1**: Job scraping + AI scoring
- ✅ **Phase 2**: Review dashboard
- ✅ **Phase 3**: Resume tailoring + cover letter
- 🔲 **Phase 4**: Playwright auto-apply engine
- 🔲 **Phase 5**: Gmail email watcher
