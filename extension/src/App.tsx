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
  FileText
} from 'lucide-react';

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

interface AutofillState {
  jobId: string;
  jobTitle: string;
  companyName: string;
  fields: ScrapedField[];
  answers: Record<string, string>;
  unresolvedFields: ScrapedField[];
  resumeTailored: boolean;
  tailoredResumeUrl?: string;
  status: 'parsing' | 'mapping' | 'waiting_for_user' | 'completed' | 'failed';
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

export default function App() {
  const [job, setJob] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Autofill agent states
  const [agentStatus, setAgentStatus] = useState<AutofillState['status'] | 'idle'>('idle');
  const [agentState, setAgentState] = useState<AutofillState | null>(null);
  const [hitlAnswers, setHitlAnswers] = useState<Record<string, string>>({});

  const socketRef = useRef<Socket | null>(null);

  // 1. Detect active page and fetch matching job from backend
  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        setError(null);

        // Fetch active tab URL from chrome extension API
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab && tab.url) {
            await detectJob(tab.url);
          } else {
            setError('Could not access active browser tab.');
            setLoading(false);
          }
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
    init();
  }, []);

  // 2. Fetch detected job
  async function detectJob(url: string) {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/jobs/detect?url=${encodeURIComponent(url)}`);
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
  function startAutofill() {
    if (!job) return;

    setAgentStatus('parsing');
    setError(null);

    // Initialize socket connection
    const socket = io(BACKEND_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to socket server:', socket.id);

      // Request content script to scrape the DOM fields
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'scrape_form' }, (response) => {
              if (chrome.runtime.lastError || !response || !response.success) {
                const errMsg = response?.error || chrome.runtime.lastError?.message || 'Content script failed to respond';
                setError(`Failed to extract form fields: ${errMsg}`);
                setAgentStatus('failed');
                socket.disconnect();
                return;
              }

              // Emit start autofill to backend agent
              socket.emit('autofill:start', {
                jobId: job.id,
                fields: response.fields,
              });
            });
          }
        });
      } else {
        // Dev Mock Scraped Fields
        setTimeout(() => {
          socket.emit('autofill:start', {
            jobId: job.id,
            fields: [
              { id: 'name', name: 'name', type: 'text', label: 'Full Name', required: true },
              { id: 'email', name: 'email', type: 'email', label: 'Email', required: true },
              { id: 'project', name: 'proj', type: 'textarea', label: 'Describe a complex project', required: true },
              { id: 'notice', name: 'notice', type: 'text', label: 'Notice Period', required: true },
              { id: 'resume', name: 'resume', type: 'file', label: 'Resume', required: true }
            ],
          });
        }, 1000);
      }
    });

    socket.on('autofill:state-change', (state: AutofillState) => {
      console.log('Agent State Update:', state.status, state);
      setAgentState(state);
      setAgentStatus(state.status);

      if (state.status === 'completed') {
        // Trigger DOM injection
        injectFieldsIntoDOM(state.answers);

        // If a tailored resume was built, trigger its download
        if (state.tailoredResumeUrl) {
          triggerResumeDownload(state.tailoredResumeUrl, state.companyName);
        }

        socket.disconnect();
      }

      if (state.status === 'failed') {
        setError(state.errorMessage || 'Autofill agent execution encountered a failure.');
        socket.disconnect();
      }
    });

    socket.on('autofill:error', (data: { message: string }) => {
      setError(data.message);
      setAgentStatus('failed');
      socket.disconnect();
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });
  }

  // 4. Send resolved HITL answers
  function resolveHitl() {
    if (!socketRef.current || !agentState) return;

    // Validate required HITL inputs
    const missing = agentState.unresolvedFields.some(f => f.required && !hitlAnswers[f.id]);
    if (missing) {
      alert('Please fill out all required fields marked with *');
      return;
    }

    setAgentStatus('mapping');
    socketRef.current.emit('autofill:hitl-resolve', { answers: hitlAnswers });
  }

  // 5. Inject values into page DOM via Content Script
  function injectFieldsIntoDOM(answers: Record<string, string>) {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: 'inject_answers', answers }, (response) => {
            console.log('DOM Injection response:', response);
          });
        }
      });
    } else {
      console.log('Dev mock injection completed.', answers);
    }
  }

  // 6. Download resume PDF
  function triggerResumeDownload(pdfUrl: string, company: string) {
    const filename = `Rishav_Sharma_Resume_${company.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    if (typeof chrome !== 'undefined' && chrome.downloads) {
      chrome.downloads.download({
        url: pdfUrl,
        filename: filename,
        saveAs: false
      });
    } else {
      // Browser fallback
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-gray-100 font-sans p-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-800 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">JH</div>
          <div>
            <h1 className="font-semibold text-sm leading-tight text-white">JobHunt Copilot</h1>
            <p className="text-[10px] text-gray-400">Sidebar Assistant v1.0</p>
          </div>
        </div>
        {job && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${job.fitScore >= 80 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
            job.fitScore >= 65 ? 'bg-amber-950 text-amber-400 border border-amber-800' :
              'bg-rose-950 text-rose-400 border border-rose-800'
            }`}>
            Fit: {job.fitScore}%
          </span>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <p className="text-xs text-gray-400">Detecting job requirements...</p>
        </div>
      ) : error ? (
        <div className="bg-rose-950/20 border border-rose-900/40 rounded-lg p-3 text-xs text-rose-400 flex gap-2 mb-4">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">Configuration Notice</p>
            <p className="leading-relaxed">{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-4">
          {/* Job Overview Panel */}
          {job && agentStatus === 'idle' && (
            <div className="bg-gray-900/50 border border-gray-800/80 rounded-xl p-3 flex flex-col gap-2.5">
              <div className="flex gap-2.5 items-start">
                <div className="w-7 h-7 rounded bg-gray-800 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                  <Briefcase className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-medium text-xs text-white leading-snug">{job.title}</h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">{job.company}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] text-gray-400 border-t border-gray-800/60 pt-2">
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-blue-500" /> {job.location}</span>
                <span className="flex items-center gap-1"><Award className="w-3 h-3 text-emerald-500" /> Score: {job.fitScore}/100</span>
              </div>
              <button
                onClick={startAutofill}
                className="w-full mt-2 py-2 px-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium text-xs rounded-lg transition-all shadow-md shadow-blue-600/10 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                Start Auto-Fill <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Stepper Progress View */}
          {agentStatus !== 'idle' && agentStatus !== 'waiting_for_user' && agentStatus !== 'completed' && agentStatus !== 'failed' && (
            <div className="bg-gray-900/30 border border-gray-800/50 rounded-xl p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Agent Executing Workflow</span>
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              </div>
              <div className="flex flex-col gap-3.5 relative pl-4 border-l border-gray-800">
                <div className={`relative text-xs flex flex-col gap-0.5 ${agentStatus === 'parsing' ? 'text-blue-400 font-medium' : 'text-gray-500'}`}>
                  <span className={`absolute -left-5 w-2.5 h-2.5 rounded-full border ${agentStatus === 'parsing' ? 'bg-blue-500 border-blue-400 animate-pulse' : 'bg-gray-800 border-gray-700'}`} />
                  <span>Parsing Form Structure</span>
                  <span className="text-[10px] text-gray-400">Extracting DOM input schema...</span>
                </div>
                <div className={`relative text-xs flex flex-col gap-0.5 ${agentStatus === 'mapping' && !agentState?.resumeTailored ? 'text-blue-400 font-medium' : 'text-gray-500'}`}>
                  <span className={`absolute -left-5 w-2.5 h-2.5 rounded-full border ${agentStatus === 'mapping' && !agentState?.resumeTailored ? 'bg-blue-500 border-blue-400 animate-pulse' : 'bg-gray-800 border-gray-700'}`} />
                  <span>Synthesizing Answers</span>
                  <span className="text-[10px] text-gray-400">RAG Context + Semantic Caching lookup...</span>
                </div>
                <div className={`relative text-xs flex flex-col gap-0.5 ${agentState?.resumeTailored === false && agentStatus === 'mapping' ? 'text-blue-400 font-medium' : 'text-gray-500'}`}>
                  <span className={`absolute -left-5 w-2.5 h-2.5 rounded-full border ${agentState?.resumeTailored === false ? 'bg-blue-500 border-blue-400 animate-pulse' : 'bg-gray-800 border-gray-700'}`} />
                  <span>Tailoring LaTeX Resume</span>
                  <span className="text-[10px] text-gray-400">Compiling offline pdflatex PDF...</span>
                </div>
              </div>

              {agentState?.progressMessage && (
                <div className="mt-4 pt-3 border-t border-gray-800 flex items-center gap-2 text-[10px] text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping shrink-0" />
                  <span className="font-mono text-gray-300 leading-snug">{agentState.progressMessage}</span>
                </div>
              )}
            </div>
          )}

          {/* HITL Custom Resolution Form */}
          {agentStatus === 'waiting_for_user' && agentState && (
            <div className="bg-gray-900/80 border border-amber-900/40 rounded-xl p-3 flex-1 flex flex-col">
              <div className="flex items-start gap-2.5 pb-2.5 border-b border-gray-800 mb-3 text-amber-400">
                <HelpCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-semibold text-xs text-white">Human Context Needed</h4>
                  <p className="text-[10px] text-gray-400 mt-0.5">Please provide missing details or review drafts:</p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto flex flex-col gap-3.5 max-h-[350px] pr-1">
                {agentState.unresolvedFields.map((field) => (
                  <div key={field.id} className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-medium text-gray-300">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        className="w-full bg-gray-950 border border-gray-800 focus:border-blue-500 rounded p-2 text-xs text-white focus:outline-none resize-none h-20"
                        placeholder="Type answer details here..."
                        value={hitlAnswers[field.id] || ''}
                        onChange={(e) => setHitlAnswers({ ...hitlAnswers, [field.id]: e.target.value })}
                      />
                    ) : field.options ? (
                      <select
                        className="w-full bg-gray-950 border border-gray-800 focus:border-blue-500 rounded p-2 text-xs text-white focus:outline-none"
                        value={hitlAnswers[field.id] || ''}
                        onChange={(e) => setHitlAnswers({ ...hitlAnswers, [field.id]: e.target.value })}
                      >
                        <option value="">Select option...</option>
                        {field.options.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="w-full bg-gray-950 border border-gray-800 focus:border-blue-500 rounded p-2 text-xs text-white focus:outline-none"
                        placeholder="Provide details..."
                        value={hitlAnswers[field.id] || ''}
                        onChange={(e) => setHitlAnswers({ ...hitlAnswers, [field.id]: e.target.value })}
                      />
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={resolveHitl}
                className="w-full mt-4 py-2 px-3 bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                Resolve & Resume <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Celebration / Final Completion Screen */}
          {agentStatus === 'completed' && agentState && (
            <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-xl p-4 flex flex-col items-center text-center gap-3">
              <CheckCircle className="w-12 h-12 text-emerald-500 animate-bounce" />
              <div>
                <h3 className="font-semibold text-sm text-white">Application Auto-filled!</h3>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  We mapped and injected all form values into the webpage inputs.
                </p>
              </div>

              {agentState.tailoredResumeUrl && (
                <div className="w-full bg-gray-900/50 border border-gray-800 rounded-lg p-3 text-left flex items-start gap-2.5 mt-2">
                  <FileText className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[11px] text-white truncate">Tailored Resume PDF</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Downloaded and ready to attach</p>
                    <button
                      onClick={() => triggerResumeDownload(agentState.tailoredResumeUrl!, agentState.companyName)}
                      className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" /> Re-download PDF
                    </button>
                  </div>
                </div>
              )}

              <div className="w-full text-left bg-blue-950/20 border border-blue-900/30 rounded-lg p-3 text-[10px] text-blue-400 mt-1">
                <p className="font-semibold mb-1">Human-in-the-Loop Actions Required:</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Find the tailored resume PDF in your downloads bar.</li>
                  <li>Drag & drop it into the "Attach Resume" field on the page.</li>
                  <li>Perform a quick visual scan of the form elements.</li>
                  <li>Manually click the "Submit" button to finalize.</li>
                </ol>
              </div>

              <button
                onClick={() => {
                  setAgentStatus('idle');
                  setAgentState(null);
                  setHitlAnswers({});
                }}
                className="w-full mt-2 py-2 px-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium text-xs rounded-lg transition-all shadow-md shadow-blue-600/10 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                Scan & Fill Next Page
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
