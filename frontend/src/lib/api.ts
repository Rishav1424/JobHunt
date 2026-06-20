import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Add request interceptor to attach JWT token
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add response interceptor to handle 401 unauthorized errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (password: string) =>
    api.post('/auth/login', { password }).then((r) => r.data as { token: string }),
};

// ─── Jobs ─────────────────────────────────────────────────────────────────────
export const jobsApi = {
  list: (params?: Record<string, string | number>) =>
    api.get('/jobs', { params }).then((r) => r.data),
  
  stats: () => api.get('/jobs/stats').then((r) => r.data),
  
  get: (id: string) => api.get(`/jobs/${id}`).then((r) => r.data),
  
  updateStatus: (id: string, status: string, options?: { whySkip?: string; userComment?: string }) =>
    api.patch(`/jobs/${id}/status`, { status, ...options }).then((r) => r.data),
  
  bulkUpdateStatus: (ids: string[], status: string, options?: { whySkip?: string; userComment?: string }) =>
    api.patch('/jobs/bulk-status', { ids, status, ...options }).then((r) => r.data),
  
  triggerScrape: (targetScraperName?: string) =>
    api.post('/jobs/scrape', { targetScraperName }).then((r) => r.data),
  
  resetScraperCircuit: (name: string) =>
    api.post(`/jobs/scrapers/${name}/reset`).then((r) => r.data),
  
  triggerScore: (id: string) => api.post(`/jobs/${id}/score`).then((r) => r.data),

  getQueueStatus: () => api.get('/jobs/queues/status').then((r) => r.data),

  drainQueue: (name: string) => api.post(`/jobs/queues/${name}/drain`).then((r) => r.data),
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
  
  compileProfile: (latex: string) =>
    api.post('/settings/profile/compile', { latex }).then((r) => r.data as { pdfUrl: string }),

  submitOnboarding: (data: { profileJson: any; qaPairs: { question: string; answer: string }[] }) =>
    api.post('/settings/onboard', data).then((r) => r.data),

  simulateScore: (data: { title: string; company?: string; description: string }) =>
    api.post('/settings/simulate-score', data).then((r) => r.data),
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
  whyApply: string;
  whySkip: string;
  salaryEstimate?: string;
  keywordsMatched: string[];
  recommendation: string;
  isTargetCompany?: boolean;
  prescreenPassed?: boolean;
  redFlags?: string[];
  domainRelevance?: string;
  dimensions?: {
    techStack: number;
    seniorityFit: number;
    domainFit: number;
    compensationFit: number;
    companyTier: number;
  };
  adjustedWeights?: Record<string, number>;
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
