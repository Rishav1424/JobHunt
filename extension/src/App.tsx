import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Briefcase,
  MapPin,
  Award,
  CheckCircle,
  Loader2,
  AlertCircle,
  ChevronRight,
  Download,
  HelpCircle,
  FileText,
  Lock,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './components/ui/card';

interface ScrapedField {
  id: string;
  name: string;
  type: string;
  label: string;
  required: boolean;
  options?: string[];
  value?: string;
  unresolved?: boolean;
}

type AutofillStateName =
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

interface AutofillState {
  applicationId?: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  fields: ScrapedField[];
  answers: Record<string, string>;
  unresolvedFields: ScrapedField[];
  resumeTailored: boolean;
  tailoredResumeUrl?: string;
  status: AutofillStateName;
  errorMessage?: string;
  progressMessage?: string;
}

interface JobDetails {
  id: string;
  title: string;
  company: string;
  location: string;
  fitScore: number;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

function getAgentStateDescription(status: string): { title: string; subtitle: string } {
  const mapping: Record<string, { title: string; subtitle: string }> = {
    PAGE_DETECT: { title: 'Sensing Page Context', subtitle: 'Analyzing current tab DOM structure...' },
    AUTH_DETECT: { title: 'Checking Credentials', subtitle: 'Scanning for login form elements...' },
    AUTH_FILL: { title: 'Authenticating', subtitle: 'Injecting login email and password...' },
    AUTH_SUBMIT: { title: 'Logging In', subtitle: 'Submitting authentication forms...' },
    OTP_WAIT: { title: 'Retrieving OTP Code', subtitle: 'Checking Gmail inbox for verification codes...' },
    MAGIC_LINK_WAIT: { title: 'Waiting for Magic Link', subtitle: 'Checking Gmail for verification link...' },
    FIELDS_EXTRACT: { title: 'Scanning Input Fields', subtitle: 'Extracting DOM form input fields...' },
    FIELDS_ANALYZE: { title: 'AI Field Analysis', subtitle: 'Classifying field intents & strategies...' },
    CONTEXT_BUILD: { title: 'Context Construction', subtitle: 'Loading candidate profile facts & RAG...' },
    ANSWERS_GENERATE: { title: 'Synthesizing Answers', subtitle: 'Generating tailored custom responses...' },
    RESUME_COMPILE: { title: 'Tailoring Resume', subtitle: 'Compiling offline resume PDF...' },
    INJECT_PLAN: { title: 'Planning Injection Workflow', subtitle: 'Formulating element injection sequence...' },
    INJECT_EXECUTE: { title: 'Injecting Answers', subtitle: 'Injecting values into inputs...' },
    INJECT_VALIDATE: { title: 'Verifying Injections', subtitle: 'Reading back elements value attributes...' },
    INJECT_RETRY: { title: 'Retrying Inputs', subtitle: 'Applying character-by-character keyboard fallbacks...' },
    PAGE_OBSERVE: { title: 'Post-Submission Check', subtitle: 'Analyzing errors or confirmation signs...' },
    NEXT_STEP: { title: 'Advancing Page Step', subtitle: 'Clicking next button to advance...' },
    parsing: { title: 'Parsing DOM Schema', subtitle: 'Scanning forms...' },
    mapping: { title: 'Mapping Profile Context', subtitle: 'Synthesizing answers...' }
  };
  return mapping[status] || { title: 'Executing Agent Loop', subtitle: 'Transitioning state machine...' };
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);

  const [job, setJob] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Autofill agent states
  const [agentStatus, setAgentStatus] = useState<any>('idle');
  const [agentState, setAgentState] = useState<AutofillState | null>(null);
  const [hitlAnswers, setHitlAnswers] = useState<Record<string, string>>({});
  const [editedAnswers, setEditedAnswers] = useState<Record<string, string>>({});
  const [failedFieldsList, setFailedFieldsList] = useState<string[]>([]);
  const [paginationInfo] = useState<{ isMultiPage: boolean; currentPage: number } | null>(null);

  // Ratings feedback states
  const [ratings, setRatings] = useState<Record<string, 'GOOD' | 'NEEDS_IMPROVEMENT' | 'WRONG'>>({});
  const [submittingRatings, setSubmittingRatings] = useState<boolean>(false);

  // Login credential states
  const [loginDomain, setLoginDomain] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [saveCreds, setSaveCreds] = useState<boolean>(true);

  const socketRef = useRef<Socket | null>(null);
  const pendingAutoStart = useRef<boolean>(false);

  // Helper for authenticated API calls
  async function fetchWithAuth(endpoint: string, options: RequestInit = {}): Promise<Response> {
    return new Promise((resolve, reject) => {
      const executeFetch = async (token: string | null) => {
        const headers = {
          ...(options.headers as Record<string, string> || {}),
          'Content-Type': 'application/json',
        } as any;
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        try {
          const res = await fetch(`${BACKEND_URL}${endpoint}`, {
            ...options,
            headers,
          });
          if (res.status === 401) {
            // Clear token and require re-auth
            if (typeof chrome !== 'undefined' && chrome.storage) {
              chrome.storage.local.remove(['token']);
            } else {
              localStorage.removeItem('token');
            }
            setIsAuthenticated(false);
          }
          resolve(res);
        } catch (err) {
          reject(err);
        }
      };

      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['token'], (result) => {
          executeFetch(result.token || null);
        });
      } else {
        executeFetch(localStorage.getItem('token'));
      }
    });
  }

  function isSupportedATSUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      if (host.includes('lever.co')) return true;
      if (host.includes('greenhouse.io')) return true;
      if (host.includes('myworkdayjobs.com')) return true;
      if (host.includes('ashbyhq.com')) return true;
      if (host.includes('wellfound.com') || host.includes('angel.co')) return true;
      if (host.includes('instahyre.com')) return true;
      if (host.includes('smartrecruiters.com')) return true;
      if (host.includes('icims.com')) return true;
      if (host.includes('taleo.net')) return true;
      if (host.includes('naukri.com')) return true;
      if (host.includes('trakstar.com')) return true;

      if (host === 'localhost' || host === '127.0.0.1') return true;

      return false;
    } catch (e) {
      return false;
    }
  }

  async function fetchJobById(jobId: string) {
    try {
      const resp = await fetchWithAuth(`/api/jobs/${jobId}`);
      if (resp.status === 404) {
        setError('Job not found in database. Please verify it is scraped and approved.');
        setLoading(false);
        return;
      }
      if (!resp.ok) throw new Error('Failed to fetch job details');
      const data = await resp.json();
      setJob({
        id: data.id,
        title: data.title,
        company: data.company,
        location: data.location || 'Remote',
        fitScore: data.fitScore || 0,
      });
      setLoading(false);
    } catch (err) {
      setError('Could not connect to backend server. Make sure the Docker container is running.');
      setLoading(false);
    }
  }

  async function detectActiveTabJob() {
    try {
      setLoading(true);
      setError(null);

      if (typeof chrome !== 'undefined' && chrome.tabs) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          setError('Could not access active browser tab.');
          setLoading(false);
          return;
        }

        // 1. Check for pending job ID in chrome.storage.session first
        const sessionKey = `pending_job_${tab.id}`;
        chrome.storage.session.get([sessionKey], async (result) => {
          let pendingJobId = result[sessionKey];

          // 2. Fallback: ask content script for pending job ID
          if (!pendingJobId && tab.id) {
            try {
              pendingJobId = await new Promise((resolve) => {
                chrome.tabs.sendMessage(tab.id!, { action: 'check_jh_pending' }, (response) => {
                  if (chrome.runtime.lastError || !response?.jobId) {
                    resolve(null);
                  } else {
                    resolve(response.jobId);
                  }
                });
              });
            } catch (e) {
              // Ignore message error
            }
          }

          // 3. If we found a pending jobId, load it directly by ID
          if (pendingJobId) {
            pendingAutoStart.current = true; // auto-start since user clicked Apply
            await fetchJobById(pendingJobId);
            return;
          }

          // 4. Otherwise, check if URL is a supported ATS
          if (tab.url && isSupportedATSUrl(tab.url)) {
            await detectJob(tab.url);
          } else {
            // Not a supported ATS and no pending job - show friendly idle state
            setJob(null);
            setLoading(false);
          }
        });
      } else {
        // Dev mock fallback
        const mockUrl = 'https://jobs.lever.co/samsung/sde-intern';
        await detectJob(mockUrl);
      }
    } catch (err) {
      setError('Error initializing extension sidebar.');
      setLoading(false);
    }
  }

  // 1. Check authentication and detect active page
  useEffect(() => {
    async function init() {
      const checkAuthToken = () => {
        return new Promise<string | null>((resolve) => {
          if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get(['token'], (result) => resolve(result.token || null));
          } else {
            resolve(localStorage.getItem('token'));
          }
        });
      };

      const token = await checkAuthToken();
      if (!token) {
        setIsAuthenticated(false);
        setLoading(false);
        return;
      }

      setIsAuthenticated(true);
      await detectActiveTabJob();
    }
    init();
  }, [isAuthenticated]);

  // Auto-start autofill when the user arrived via an Apply link (__jh param)
  useEffect(() => {
    if (job && pendingAutoStart.current && agentStatus === 'idle') {
      pendingAutoStart.current = false;
      // Small delay to let the panel render before starting
      setTimeout(() => startAutofill(), 400);
    }
  }, [job]);

  // Hook to handle incoming runtime messages (login request, OTP progress)
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      const listener = (message: any, _sender: any, _sendResponse: any) => {
        if (message.action === 'login_needed') {
          setLoginDomain(message.hostname);
          setAgentStatus('login_needed');
        } else if (message.action === 'otp_checking') {
          if (agentState) {
            setAgentState(prev => prev ? { ...prev, progressMessage: 'Checking Gmail for OTP...' } : null);
          }
        } else if (message.action === 'otp_filled') {
          if (agentState) {
            setAgentState(prev => prev ? { ...prev, progressMessage: `Successfully filled OTP: ${message.otp}` } : null);
          }
        } else if (message.action === 'otp_failed') {
          if (agentState) {
            setAgentState(prev => prev ? { ...prev, progressMessage: 'Gmail OTP retrieval timed out. Please enter code manually.' } : null);
          }
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    }
  }, [agentState]);

  // Handle credential submission
  function submitCredentials() {
    if (!loginDomain) return;

    if (saveCreds) {
      chrome.storage.local.set({
        [`creds_${loginDomain}`]: { email: loginEmail, password: loginPassword }
      });
    }

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab && tab.id) {
        chrome.tabs.sendMessage(
          tab.id,
          { action: 'fill_login', creds: { email: loginEmail, password: loginPassword } },
          (response) => {
            if (response && response.success) {
              setAgentStatus('parsing');
              setLoginDomain(null);
            } else {
              alert('Failed to fill credentials: ' + (response?.error || 'Unknown error'));
            }
          }
        );
      }
    });
  }

  // 2. Fetch detected job
  async function detectJob(url: string) {
    try {
      const resp = await fetchWithAuth(`/api/jobs/detect?url=${encodeURIComponent(url)}`);
      if (resp.status === 404) {
        setError('No matching Job found in database for this URL. Please verify this job is scraped and approved.');
        setLoading(false);
        return;
      }
      if (!resp.ok) throw new Error('Failed to query job detector');
      const data = await resp.json();
      setJob({
        id: data.id,
        title: data.title,
        company: data.company,
        location: data.location || 'Remote',
        fitScore: data.fitScore || 0,
      });
      setLoading(false);
    } catch (err) {
      setError('Could not connect to backend server. Make sure the Docker container is running.');
      setLoading(false);
    }
  }

  // 3. Connect Socket.IO on agent start
  function approvePreview() {
    if (!socketRef.current || !agentState) return;
    setAgentStatus('mapping');
    socketRef.current.emit('autofill:hitl-resolve', { jobId: job?.id, answers: editedAnswers });
  }

  async function submitRatings() {
    if (!agentState?.applicationId) {
      resetState();
      return;
    }

    try {
      setSubmittingRatings(true);
      const ratingsPayload = Object.entries(ratings).map(([question, rating]) => ({
        question,
        rating,
      }));

      const res = await fetchWithAuth(`/api/applications/${agentState.applicationId}/answer-ratings`, {
        method: 'POST',
        body: JSON.stringify({ ratings: ratingsPayload }),
      });
      if (res.ok) {
        alert('Ratings saved successfully!');
        resetState();
      } else {
        alert('Failed to submit ratings.');
      }
    } catch (err) {
      console.error(err);
      resetState();
    } finally {
      setSubmittingRatings(false);
    }
  }

  function startAutofill() {
    if (!job) return;

    setAgentStatus('parsing');
    setError(null);

    // Initialize socket connection with Auth token
    const connectSocket = (token: string | null) => {
      const socket = io(BACKEND_URL, {
        extraHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('Connected to socket server:', socket.id);

        const tabIdPromise = new Promise<number>((resolveTab) => {
          if (typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
              if (tab && tab.id) resolveTab(tab.id);
              else resolveTab(-1);
            });
          } else {
            resolveTab(-1);
          }
        });

        // ── Socket relays to content script ──
        socket.on('page:classify', async () => {
          const tabId = await tabIdPromise;
          if (tabId === -1) {
            socket.emit('page:classify:response', { pageType: 'application_form', url: '', jobId: job.id });
            return;
          }
          chrome.tabs.sendMessage(tabId, { action: 'page:classify' }, (response) => {
            socket.emit('page:classify:response', { ...(response || { pageType: 'unknown', url: '' }), jobId: job.id });
          });
        });

        socket.on('fields:extract', async () => {
          const tabId = await tabIdPromise;
          if (tabId === -1) {
            socket.emit('fields:extract:response', { success: true, fields: [], jobId: job.id });
            return;
          }
          chrome.tabs.sendMessage(tabId, { action: 'fields:extract' }, (response) => {
            socket.emit('fields:extract:response', { ...(response || { success: false }), jobId: job.id });
          });
        });

        socket.on('field:inject', async (payload) => {
          const tabId = await tabIdPromise;
          if (tabId === -1) {
            socket.emit('field:inject:response', { success: true, jobId: job.id });
            return;
          }
          chrome.tabs.sendMessage(tabId, { action: 'field:inject', fieldId: payload.fieldId, value: payload.value, strategies: payload.strategies }, (response) => {
            socket.emit('field:inject:response', { ...(response || { success: false }), jobId: job.id });
          });
        });

        socket.on('fields:validate', async (payload) => {
          const tabId = await tabIdPromise;
          if (tabId === -1) {
            socket.emit('fields:validate:response', { success: true, results: {}, jobId: job.id });
            return;
          }
          chrome.tabs.sendMessage(tabId, { action: 'fields:validate', fieldIds: payload.fieldIds }, (response) => {
            socket.emit('fields:validate:response', { ...(response || { success: false }), jobId: job.id });
          });
        });

        socket.on('page:observe', async () => {
          const tabId = await tabIdPromise;
          if (tabId === -1) {
            socket.emit('page:observe:response', { success: true, confirmationDetected: false, errorDetected: false, jobId: job.id });
            return;
          }
          chrome.tabs.sendMessage(tabId, { action: 'page:observe' }, (response) => {
            socket.emit('page:observe:response', { ...(response || { success: false }), jobId: job.id });
          });
        });

        socket.on('field:upload', async (payload) => {
          const tabId = await tabIdPromise;
          if (tabId === -1) {
            socket.emit('field:upload:response', { success: true, jobId: job.id });
            return;
          }
          chrome.tabs.sendMessage(tabId, { action: 'field:upload', fieldId: payload.fieldId, fileUrl: payload.fileUrl, filename: payload.filename }, (response) => {
            socket.emit('field:upload:response', { ...(response || { success: false }), jobId: job.id });
          });
        });

        socket.on('dom:click', async (payload) => {
          const tabId = await tabIdPromise;
          if (tabId === -1) {
            socket.emit('dom:click:response', { success: true, jobId: job.id });
            return;
          }
          chrome.tabs.sendMessage(tabId, { action: 'dom:click', selector: payload.selector }, (response) => {
            socket.emit('dom:click:response', { ...(response || { success: false }), jobId: job.id });
          });
        });

        socket.on('dom:navigate', async (payload) => {
          const tabId = await tabIdPromise;
          if (tabId === -1 || !payload?.url) {
            socket.emit('dom:navigate:response', { success: false, error: 'No active tab or URL', jobId: job.id });
            return;
          }
          try {
            await chrome.tabs.update(tabId, { url: payload.url });
            socket.emit('dom:navigate:response', { success: true, jobId: job.id });
          } catch (err: any) {
            socket.emit('dom:navigate:response', { success: false, error: err.message, jobId: job.id });
          }
        });

        socket.on('auth:check-credentials', async (payload) => {
          if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get([`creds_${payload.hostname}`], (result) => {
              const creds = result[`creds_${payload.hostname}`];
              socket.emit('auth:check-credentials:response', { hasCreds: !!creds, creds, jobId: job.id });
            });
          } else {
            socket.emit('auth:check-credentials:response', { hasCreds: false, jobId: job.id });
          }
        });

        socket.on('auth:fill-credentials', async () => {
          const tabId = await tabIdPromise;
          if (tabId === -1) {
            socket.emit('auth:fill-credentials:response', { success: true, jobId: job.id });
            return;
          }
          chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (tab && tab.url) {
              const domain = new URL(tab.url).hostname;
              chrome.storage.local.get([`creds_${domain}`], (result) => {
                const creds = result[`creds_${domain}`];
                if (creds) {
                  chrome.tabs.sendMessage(tabId, { action: 'fill_login', creds }, (response) => {
                    socket.emit('auth:fill-credentials:response', { ...(response || { success: false }), jobId: job.id });
                  });
                } else {
                  socket.emit('auth:fill-credentials:response', { success: false, error: 'No credentials stored', jobId: job.id });
                }
              });
            }
          });
        });

        socket.on('otp:retrieve', async () => {
          if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.sendMessage({ action: 'get_gmail_otp' }, (response) => {
              socket.emit('otp:retrieve:response', { otp: response?.otp || null, jobId: job.id });
            });
          } else {
            socket.emit('otp:retrieve:response', { otp: null, jobId: job.id });
          }
        });

        socket.on('magic_link:retrieve', async () => {
          if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.sendMessage({ action: 'get_gmail_verification' }, (response) => {
              socket.emit('magic_link:retrieve:response', { url: response?.url || null, jobId: job.id });
            });
          } else {
            socket.emit('magic_link:retrieve:response', { url: null, jobId: job.id });
          }
        });

        // Start machine
        socket.emit('autofill:start', { jobId: job.id });
      });

      socket.on('autofill:state-change', (state: AutofillState) => {
        console.log('Agent State Update:', state.status, state);
        setAgentState(state);

        if (state.status === 'HITL_REQUIRED') {
          if (state.unresolvedFields && state.unresolvedFields.length > 0) {
            setAgentStatus('waiting_for_user');
          } else {
            // No unresolved fields: it is the preview confirmation phase!
            setEditedAnswers({ ...state.answers });
            setAgentStatus('preview');
          }
        } else if (state.status === 'COMPLETED') {
          setAgentStatus('autofill_completed');
          socket.disconnect();
        } else if (state.status === 'FAILED') {
          setAgentStatus('failed');
          socket.disconnect();
        } else {
          setAgentStatus(state.status as any);
        }
      });

      socket.on('autofill:error', (data: { message: string }) => {
        setError(data.message);
        setAgentStatus('failed');
        socket.disconnect();
      });
    };

    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['token'], (result) => connectSocket(result.token || null));
    } else {
      connectSocket(localStorage.getItem('token'));
    }
  }

  // 4. Inject all answers with validation
  function injectAllAnswers() {
    approvePreview();
  }

  // 5. Send resolved HITL answers
  function resolveHitl() {
    if (!socketRef.current || !agentState) return;

    const missing = agentState.unresolvedFields.some(f => f.required && !hitlAnswers[f.id]);
    if (missing) {
      alert('Please fill out all required fields marked with *');
      return;
    }

    setAgentStatus('mapping');
    socketRef.current.emit('autofill:hitl-resolve', { jobId: job?.id, answers: hitlAnswers });
  }

  // 6. Handle login
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      setAuthLoading(true);
      setAuthError(null);
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        throw new Error('Invalid dashboard password.');
      }
      const data = await res.json();
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ token: data.token }, () => {
          setIsAuthenticated(true);
        });
      } else {
        localStorage.setItem('token', data.token);
        setIsAuthenticated(true);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Login failed.');
    } finally {
      setAuthLoading(false);
    }
  }

  // 7. Download PDF
  function triggerResumeDownload(pdfUrl: string, company: string) {
    const filename = `Rishav_Sharma_Resume_${company.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    if (typeof chrome !== 'undefined' && chrome.downloads) {
      chrome.downloads.download({
        url: pdfUrl,
        filename: filename,
        saveAs: false
      });
    } else {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  // 8. Log out
  const handleLogout = () => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.remove(['token'], () => {
        setIsAuthenticated(false);
      });
    } else {
      localStorage.removeItem('token');
      setIsAuthenticated(false);
    }
  };

  function resetState() {
    setAgentStatus('idle');
    setAgentState(null);
    setHitlAnswers({});
    setEditedAnswers({});
    setFailedFieldsList([]);
  }

  // Login view
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col min-h-screen bg-background text-foreground font-sans p-6 justify-center">
        <Card className="max-w-sm mx-auto w-full border-border">
          <CardHeader className="text-center pb-2">
            <div className="w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold shadow-md mx-auto mb-2 select-none">JH</div>
            <CardTitle className="text-base font-semibold">JobHunt Copilot</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Please enter your dashboard password to authenticate the Chrome extension.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5 text-left">
                <label className="text-xs font-semibold text-muted-foreground">Password</label>
                <div className="relative">
                  <Input
                    type="password"
                    className="pl-9"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <Lock className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-2.5" />
                </div>
              </div>

              {authError && (
                <p className="text-[10px] text-destructive font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {authError}
                </p>
              )}

              <Button
                type="submit"
                disabled={authLoading}
                className="w-full mt-2 cursor-pointer"
              >
                {authLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Authenticate'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-sans p-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold shadow-sm select-none">JH</div>
          <div>
            <h1 className="font-semibold text-sm leading-tight">JobHunt Copilot</h1>
            {paginationInfo && paginationInfo.isMultiPage && (
              <p className="text-[10px] text-primary font-medium mt-0.5">Wizard Step: {paginationInfo.currentPage}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {job && (
            <Badge variant={job.fitScore >= 80 ? 'success' : job.fitScore >= 65 ? 'warning' : 'destructive'}>
              Fit: {job.fitScore}%
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-[10px] h-6 px-2 text-muted-foreground hover:text-destructive">
            Logout
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground">Detecting job requirements...</p>
        </div>
      ) : error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-destructive mb-4">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
              <CardTitle className="text-xs text-destructive font-bold">Configuration Notice</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-xs leading-relaxed space-y-3">
            <p>{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={detectActiveTabJob}
              className="text-[10px] border-destructive/20 hover:bg-destructive/10 text-destructive cursor-pointer h-7"
            >
              <RefreshCw className="w-3 h-3 mr-1" /> Retry Detection
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex-1 flex flex-col gap-4">
          {/* No Active Job Overview Panel */}
          {!job && agentStatus === 'idle' && (
            <Card className="border-border/60 bg-card/30 backdrop-blur-sm shadow-sm py-6">
              <CardContent className="flex flex-col items-center text-center p-6 gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold shadow-inner select-none animate-pulse">
                  <Briefcase className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="font-semibold text-sm leading-snug">No Active Job Application</h3>
                  <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
                    Open a job from your dashboard and click <strong>Apply</strong>, or navigate to a supported application form to begin.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Job Overview Panel */}
          {job && agentStatus === 'idle' && (
            <Card className="bg-card/50">
              <CardContent className="p-3 flex flex-col gap-2.5">
                <div className="flex gap-2.5 items-start">
                  <div className="w-7 h-7 rounded bg-muted flex items-center justify-center text-primary shrink-0 mt-0.5">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-xs leading-snug">{job.title}</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{job.company}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground border-t border-border pt-2">
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
                  <span className="flex items-center gap-1"><Award className="w-3 h-3" /> Score: {job.fitScore}/100</span>
                </div>
                <Button
                  onClick={startAutofill}
                  className="w-full mt-2 cursor-pointer"
                >
                  Start Auto-Fill <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Stepper Progress View */}
          {agentStatus !== 'idle' && agentStatus !== 'waiting_for_user' && agentStatus !== 'preview' && agentStatus !== 'validation_failed' && agentStatus !== 'autofill_completed' && agentStatus !== 'failed' && agentStatus !== 'login_needed' && (
            <Card className="bg-card/30">
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-xs text-primary uppercase tracking-wider font-bold">Agent Executing Workflow</CardTitle>
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              </CardHeader>
              <CardContent className="flex flex-col gap-3.5 relative pl-4 border-l border-border">
                {(() => {
                  const info = getAgentStateDescription(agentStatus);
                  return (
                    <div className="relative text-xs flex flex-col gap-0.5 text-primary font-medium animate-pulse">
                      <span className="absolute -left-5 w-2.5 h-2.5 rounded-full bg-primary border border-primary" />
                      <span>{info.title}</span>
                      <span className="text-[10px] opacity-70 leading-relaxed text-muted-foreground">{info.subtitle}</span>
                    </div>
                  );
                })()}
              </CardContent>
              {agentState?.progressMessage && (
                <CardFooter className="pt-3 border-t border-border flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping shrink-0" />
                  <span className="font-mono text-foreground leading-snug">{agentState.progressMessage}</span>
                </CardFooter>
              )}
            </Card>
          )}

          {/* Login Needed Form */}
          {agentStatus === 'login_needed' && loginDomain && (
            <Card className="bg-card border-primary/45 flex-1 flex flex-col">
              <CardHeader className="pb-2.5 border-b border-border mb-3 text-primary">
                <div className="flex items-start gap-2.5">
                  <Lock className="w-5 h-5 mt-0.5 shrink-0" />
                  <div>
                    <CardTitle className="text-xs text-foreground">Login Required</CardTitle>
                    <CardDescription>Enter credentials for {loginDomain}:</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col gap-3.5">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground">Email / Username</label>
                  <Input
                    type="text"
                    placeholder="email@example.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold text-muted-foreground">Password</label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    id="saveCreds"
                    checked={saveCreds}
                    onChange={(e) => setSaveCreds(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <label htmlFor="saveCreds" className="text-[11px] text-muted-foreground cursor-pointer select-none">
                    Save credentials for this site
                  </label>
                </div>
              </CardContent>
              <CardFooter className="pt-4">
                <Button onClick={submitCredentials} className="w-full cursor-pointer">
                  Fill Credentials & Resume <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* HITL Custom Resolution Form */}
          {agentStatus === 'waiting_for_user' && agentState && (
            <Card className="bg-card border-warning/45 flex-1 flex flex-col">
              <CardHeader className="pb-2.5 border-b border-border mb-3 text-warning">
                <div className="flex items-start gap-2.5">
                  <HelpCircle className="w-5 h-5 mt-0.5 shrink-0" />
                  <div>
                    <CardTitle className="text-xs text-foreground">Human Context Needed</CardTitle>
                    <CardDescription>Please provide missing details or review drafts:</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto flex flex-col gap-3.5 max-h-[350px] pr-1">
                {agentState.unresolvedFields.map((field) => (
                  <div key={field.id} className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium text-foreground">
                      {field.label} {field.required && <span className="text-destructive">*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        className="w-full bg-background border border-input focus:border-ring rounded p-2 text-xs text-foreground focus:outline-none resize-none h-20"
                        placeholder="Type answer details here..."
                        value={hitlAnswers[field.id] || ''}
                        onChange={(e) => setHitlAnswers({ ...hitlAnswers, [field.id]: e.target.value })}
                      />
                    ) : field.options ? (
                      <select
                        className="w-full bg-background border border-input focus:border-ring rounded p-2 text-xs text-foreground focus:outline-none"
                        value={hitlAnswers[field.id] || ''}
                        onChange={(e) => setHitlAnswers({ ...hitlAnswers, [field.id]: e.target.value })}
                      >
                        <option value="">Select option...</option>
                        {field.options.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        type="text"
                        placeholder="Provide details..."
                        value={hitlAnswers[field.id] || ''}
                        onChange={(e) => setHitlAnswers({ ...hitlAnswers, [field.id]: e.target.value })}
                      />
                    )}
                  </div>
                ))}
              </CardContent>
              <CardFooter className="pt-4">
                <Button
                  onClick={resolveHitl}
                  className="w-full cursor-pointer bg-warning border-transparent text-white hover:bg-warning/90"
                >
                  Resolve & Resume <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* Pre-inject Preview Panel */}
          {agentStatus === 'preview' && agentState && (
            <Card className="bg-card border-primary/45 flex-1 flex flex-col">
              <CardHeader className="pb-2.5 border-b border-border mb-3 text-primary">
                <div className="flex items-start gap-2.5">
                  <FileText className="w-5 h-5 mt-0.5 shrink-0" />
                  <div>
                    <CardTitle className="text-xs text-foreground">Review Proposed Answers</CardTitle>
                    <CardDescription>Edit any field details below before injecting:</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto flex flex-col gap-3.5 max-h-[350px] pr-1">
                {Object.entries(agentState.answers).map(([id, answer]) => {
                  const field = agentState.fields.find(f => f.id === id);
                  if (field?.type === 'file') return null; // Resumes/Files are handled separately

                  return (
                    <div key={id} className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold text-muted-foreground">
                        {field?.label || id}
                      </label>
                      {field?.type === 'textarea' || answer.length > 50 ? (
                        <textarea
                          className="w-full bg-background border border-input focus:border-ring rounded p-2 text-xs text-foreground focus:outline-none resize-none h-16"
                          value={editedAnswers[id] !== undefined ? editedAnswers[id] : answer}
                          onChange={(e) => setEditedAnswers({ ...editedAnswers, [id]: e.target.value })}
                        />
                      ) : (
                        <Input
                          type="text"
                          value={editedAnswers[id] !== undefined ? editedAnswers[id] : answer}
                          onChange={(e) => setEditedAnswers({ ...editedAnswers, [id]: e.target.value })}
                        />
                      )}
                    </div>
                  );
                })}
              </CardContent>
              <CardFooter className="pt-4">
                <Button
                  onClick={injectAllAnswers}
                  className="w-full cursor-pointer"
                >
                  Inject Answers & Resume <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* Validation Failed Report */}
          {agentStatus === 'validation_failed' && agentState && (
            <Card className="bg-card border-warning/45">
              <CardHeader className="pb-3 flex flex-row items-center gap-2 text-warning">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
                <CardTitle className="text-sm text-foreground">Validation Alert</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Some form elements failed to register the automated injection. Please review and fill these manually:
                </p>

                <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto">
                  {failedFieldsList.map((id) => {
                    const field = agentState.fields.find(f => f.id === id);
                    const ansVal = editedAnswers[id] || '';
                    return (
                      <div key={id} className="bg-background p-2.5 rounded border border-warning/20 text-xs">
                        <span className="font-semibold text-warning block mb-1">{field?.label || id}</span>
                        <div className="flex items-center justify-between gap-2 bg-muted p-1.5 rounded text-[11px] font-mono text-muted-foreground">
                          <span className="truncate">{ansVal}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigator.clipboard.writeText(ansVal)}
                            className="h-5 px-1.5 text-primary"
                          >
                            Copy
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={injectAllAnswers}
                    className="flex-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry Inject
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setAgentStatus('autofill_completed')}
                    className="flex-1"
                  >
                    Ignore & Done
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Celebration / Final Completion Screen */}
          {agentStatus === 'autofill_completed' && agentState && (
            <Card className="border-success/35 bg-success/10 text-center">
              <CardContent className="p-4 flex flex-col items-center gap-3">
                <CheckCircle className="w-12 h-12 text-emerald-500 animate-bounce" />
                <div>
                  <h3 className="font-semibold text-sm text-foreground">Application Auto-filled!</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    We mapped and injected all form values into the page inputs.
                  </p>
                </div>

                {agentState.tailoredResumeUrl && (
                  <Card className="w-full bg-background border-border text-left">
                    <CardContent className="p-3 flex items-start gap-2.5">
                      <FileText className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[11px] text-foreground truncate">Tailored Resume PDF</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">Downloaded and ready to attach</p>
                        <button
                          onClick={() => triggerResumeDownload(agentState.tailoredResumeUrl!, agentState.companyName)}
                          className="mt-2 text-[10px] text-primary hover:underline font-medium flex items-center gap-1 cursor-pointer bg-transparent border-none p-0"
                        >
                          <Download className="w-3 h-3" /> Re-download PDF
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="w-full text-left bg-muted border border-border rounded-lg p-3 text-[10px] text-muted-foreground mt-1">
                  <p className="font-semibold mb-2 text-foreground">Rate Generated Answers:</p>
                  <div className="space-y-3 max-h-[160px] overflow-y-auto pr-1 mb-3">
                    {Object.entries(agentState.answers).map(([id, answer]) => {
                      const field = agentState.fields.find(f => f.id === id);
                      if (field?.type === 'file') return null;
                      const question = field?.label || id;
                      const currentRating = ratings[question];

                      return (
                        <div key={id} className="flex flex-col gap-1 border-b border-border/40 pb-2 last:border-b-0">
                          <span className="font-semibold text-foreground text-[9px]">{question}</span>
                          <span className="text-muted-foreground italic text-[9px] truncate mb-1">"{answer}"</span>
                          <div className="flex gap-2">
                            {(['GOOD', 'NEEDS_IMPROVEMENT', 'WRONG'] as const).map((r) => (
                              <button
                                key={r}
                                onClick={() => setRatings({ ...ratings, [question]: r })}
                                className={`text-[8px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer ${currentRating === r
                                  ? r === 'GOOD' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-500'
                                    : r === 'NEEDS_IMPROVEMENT' ? 'bg-amber-500/10 border-amber-500 text-amber-500'
                                      : 'bg-destructive/10 border-destructive text-destructive'
                                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
                                  }`}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    onClick={submitRatings}
                    disabled={submittingRatings}
                    className="w-full mt-1 cursor-pointer text-[10px] h-7 bg-primary"
                  >
                    {submittingRatings ? 'Saving...' : 'Submit Ratings & Done'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
