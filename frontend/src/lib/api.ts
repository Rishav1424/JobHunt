import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────
export const jobsApi = {
  list: (params?: Record<string, string | number>) =>
    api.get('/jobs', { params }).then((r) => r.data),
  
  stats: () => api.get('/jobs/stats').then((r) => r.data),
  
  get: (id: string) => api.get(`/jobs/${id}`).then((r) => r.data),
  
  updateStatus: (id: string, status: string) =>
    api.patch(`/jobs/${id}/status`, { status }).then((r) => r.data),
  
  triggerScrape: () => api.post('/jobs/scrape').then((r) => r.data),
  
  triggerScore: (id: string) => api.post(`/jobs/${id}/score`).then((r) => r.data),
};

// ─── Applications ─────────────────────────────────────────────────────────────
export const applicationsApi = {
  list: (params?: Record<string, string>) =>
    api.get('/applications', { params }).then((r) => r.data),
  
  get: (id: string) => api.get(`/applications/${id}`).then((r) => r.data),
  
  getByJob: (jobId: string) =>
    api.get(`/applications/by-job/${jobId}`).then((r) => r.data),
  
  tailorResume: (jobId: string) =>
    api.post(`/applications/${jobId}/tailor`).then((r) => r.data),
  
  generateCoverLetter: (jobId: string) =>
    api.post(`/applications/${jobId}/cover-letter`).then((r) => r.data),
  
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/applications/${id}`, data).then((r) => r.data),
};

// ─── Settings ─────────────────────────────────────────────────────────────────
export const settingsApi = {
  get: () => api.get('/settings').then((r) => r.data),
  update: (data: Record<string, unknown>) =>
    api.patch('/settings', data).then((r) => r.data),
  
  getProfile: () => api.get('/settings/profile').then((r) => r.data),
  updateProfile: (data: Record<string, unknown>) =>
    api.patch('/settings/profile', data).then((r) => r.data),
};

// ─── Types ────────────────────────────────────────────────────────────────────
export type JobStatus =
  | 'NEW' | 'SCORING' | 'SCORED' | 'REVIEWING'
  | 'APPROVED' | 'APPLYING' | 'APPLIED' | 'SKIPPED' | 'BLACKLISTED';

export type ApplicationStatus =
  | 'PENDING' | 'APPLIED' | 'INTERVIEW' | 'OFFER' | 'REJECTED' | 'WITHDRAWN';

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  isRemote: boolean;
  description: string;
  url: string;
  applyUrl?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryRaw?: string;
  salaryType: 'CONFIRMED' | 'ESTIMATED' | 'UNKNOWN';
  source: string;
  atsType?: string;
  fitScore?: number;
  fitAnalysis?: FitAnalysis;
  status: JobStatus;
  scrapedAt: string;
  scoredAt?: string;
  application?: { status: ApplicationStatus };
}

export interface FitAnalysis {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  reasons: string[];
  salaryEstimate?: string;
  keywordsMatched: string[];
  recommendation: string;
}

export interface Application {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  tailoredResumeLatex?: string;
  coverLetter?: string;
  changesSummary?: string[];
  customNotes?: string;
  formAnswers?: Record<string, string>;
  appliedAt?: string;
  createdAt?: string;
  job: Job;
  emailEvents: EmailEvent[];
}

export interface EmailEvent {
  id: string;
  type: string;
  subject: string;
  fromEmail: string;
  receivedAt: string;
  summary?: string;
}
