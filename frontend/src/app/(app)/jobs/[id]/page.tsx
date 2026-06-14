'use client';

import { useEffect, useState, use } from 'react';
import { jobsApi, applicationsApi, Job, Application } from '@/lib/api';
import {
  ExternalLink, MapPin, Building2, DollarSign, CheckCircle,
  XCircle, ArrowLeft, Wand2, FileText, Loader2, Star
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [tailoring, setTailoring] = useState(false);
  const [generatingCL, setGeneratingCL] = useState(false);
  const [activeTab, setActiveTab] = useState<'analysis' | 'resume' | 'cover-letter'>('analysis');

  useEffect(() => {
    Promise.all([
      jobsApi.get(id),
      applicationsApi.getByJob(id).catch(() => null),
    ]).then(([jobData, appData]) => {
      setJob(jobData);
      setApplication(appData);
    }).finally(() => setLoading(false));
  }, [id]);

  const handleApprove = async () => {
    if (!job) return;
    await jobsApi.updateStatus(job.id, 'APPROVED');
    setJob((j) => j ? { ...j, status: 'APPROVED' } : j);
  };

  const handleTailor = async () => {
    if (!job) return;
    setTailoring(true);
    try {
      const result = await applicationsApi.tailorResume(job.id);
      setApplication((a) => a ? { ...a, tailoredResumeLatex: result.modifiedLatex, changesSummary: result.changesSummary } : a);
      setActiveTab('resume');
    } finally {
      setTailoring(false);
    }
  };

  const handleGenerateCL = async () => {
    if (!job) return;
    setGeneratingCL(true);
    try {
      const result = await applicationsApi.generateCoverLetter(job.id);
      setApplication((a) => a ? { ...a, coverLetter: result.text } : a);
      setActiveTab('cover-letter');
    } finally {
      setGeneratingCL(false);
    }
  };

  if (loading || !job) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  const analysis = job.fitAnalysis;
  const scoreClass = job.fitScore !== undefined
    ? job.fitScore >= 75 ? 'high' : job.fitScore >= 55 ? 'mid' : 'low'
    : 'low';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Back */}
      <Link href="/jobs" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Jobs
      </Link>

      {/* Job Header */}
      <div className="glass rounded-xl p-6 border border-gray-800">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-xl font-bold text-white">{job.title}</h1>
              {job.fitScore !== undefined && (
                <div className={`badge-score ${scoreClass}`}>{job.fitScore}%</div>
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-gray-400">
                <Building2 className="w-4 h-4" /> {job.company}
              </span>
              <span className="flex items-center gap-1.5 text-gray-400">
                <MapPin className="w-4 h-4" /> {job.isRemote ? 'Remote' : job.location}
              </span>
              {job.salaryRaw && (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <DollarSign className="w-4 h-4" /> {job.salaryRaw}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 shrink-0">
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-xs border border-gray-700 text-gray-300 hover:border-blue-500 hover:text-white rounded-lg transition-all"
            >
              <ExternalLink className="w-3.5 h-3.5" /> View JD
            </a>
            {job.status === 'SCORED' && (
              <button
                onClick={handleApprove}
                className="flex items-center gap-2 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-all"
              >
                <CheckCircle className="w-3.5 h-3.5" /> Approve
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* JD */}
        <div className="lg:col-span-2 glass rounded-xl p-5 border border-gray-800">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Job Description</h2>
          <div className="text-xs text-gray-400 leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap">
            {job.description}
          </div>
        </div>

        {/* Right panel */}
        <div className="lg:col-span-3 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 w-fit">
            {(['analysis', 'resume', 'cover-letter'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize',
                  activeTab === tab ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                )}
              >
                {tab.replace('-', ' ')}
              </button>
            ))}
          </div>

          {/* Analysis Tab */}
          {activeTab === 'analysis' && analysis && (
            <div className="glass rounded-xl p-5 border border-gray-800 space-y-4">
              <div className="flex items-center gap-3">
                <Star className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-semibold text-white">{analysis.verdict}</span>
              </div>

              {analysis.strengths?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-2">Strengths</p>
                  <ul className="space-y-1">
                    {analysis.strengths.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-green-400">
                        <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.gaps?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-2">Gaps</p>
                  <ul className="space-y-1">
                    {analysis.gaps.map((g, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-red-400">
                        <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.salaryEstimate && (
                <p className="text-xs text-gray-400">
                  <span className="text-gray-500">Estimated CTC: </span>
                  <span className="text-emerald-400 font-medium">{analysis.salaryEstimate}</span>
                </p>
              )}

              <p className="text-xs text-blue-400 italic">{analysis.recommendation}</p>

              {/* Generate buttons */}
              <div className="flex gap-2 pt-2 border-t border-gray-800">
                <button
                  onClick={handleTailor}
                  disabled={tailoring}
                  className="flex items-center gap-2 px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  {tailoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  Tailor Resume
                </button>
                <button
                  onClick={handleGenerateCL}
                  disabled={generatingCL}
                  className="flex items-center gap-2 px-3 py-2 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  {generatingCL ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                  Cover Letter
                </button>
              </div>
            </div>
          )}

          {/* Resume Tab */}
          {activeTab === 'resume' && (
            <div className="glass rounded-xl p-5 border border-gray-800">
              {application?.tailoredResumeLatex ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-white">Tailored Resume (LaTeX)</p>
                    <span className="text-xs text-blue-400">
                      {application.changesSummary?.length || 0} changes
                    </span>
                  </div>
                  {application.changesSummary && (
                    <ul className="mb-3 space-y-1">
                      {application.changesSummary.map((c, i) => (
                        <li key={i} className="text-xs text-gray-400">• {c}</li>
                      ))}
                    </ul>
                  )}
                  <pre className="text-xs text-gray-300 bg-gray-900/50 p-3 rounded-lg overflow-auto max-h-64 font-mono">
                    {application.tailoredResumeLatex.slice(0, 1000)}...
                  </pre>
                </>
              ) : (
                <div className="text-center py-8">
                  <Wand2 className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No tailored resume yet</p>
                  <button onClick={handleTailor} disabled={tailoring}
                    className="mt-3 px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-all disabled:opacity-50">
                    {tailoring ? 'Generating...' : 'Generate Now'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Cover Letter Tab */}
          {activeTab === 'cover-letter' && (
            <div className="glass rounded-xl p-5 border border-gray-800">
              {application?.coverLetter ? (
                <>
                  <p className="text-sm font-semibold text-white mb-3">Cover Letter</p>
                  <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {application.coverLetter}
                  </p>
                </>
              ) : (
                <div className="text-center py-8">
                  <FileText className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No cover letter yet</p>
                  <button onClick={handleGenerateCL} disabled={generatingCL}
                    className="mt-3 px-4 py-2 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-all disabled:opacity-50">
                    {generatingCL ? 'Generating...' : 'Generate Now'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
