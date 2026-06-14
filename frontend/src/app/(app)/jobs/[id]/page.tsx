'use client';

import { useEffect, useState, use } from 'react';
import { jobsApi, applicationsApi, Job, Application } from '@/lib/api';
import {
  ExternalLink, MapPin, Building2, DollarSign, CheckCircle,
  XCircle, ArrowLeft, Wand2, FileText, Loader2, Star, AlertTriangle, Info
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue } from '@/components/ui/progress';

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
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const analysis = job.fitAnalysis as any;
  const scoreClass = job.fitScore !== undefined
    ? job.fitScore >= 75 ? 'high' : job.fitScore >= 55 ? 'mid' : 'low'
    : 'low';

  const dimensionLabels: Record<string, string> = {
    techStack: 'Tech Stack Match',
    seniorityFit: 'Seniority Fit',
    domainFit: 'Domain Fit',
    compensationFit: 'Compensation Fit',
    companyTier: 'Company Tier & Reputation',
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <Link href="/jobs" className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to Job Queue
      </Link>

      {/* Job Header Card */}
      <Card className="border-gray-800 bg-gray-950/40 backdrop-blur-md">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-3 mb-2">
                <h1 className="text-2xl font-bold text-white tracking-tight leading-none">{job.title}</h1>
                {job.fitScore !== undefined && (
                  <div className={`badge-score ${scoreClass} text-sm`}>{job.fitScore}% Match</div>
                )}
                {analysis?.isTargetCompany && (
                  <span className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-xs px-2.5 py-0.5 rounded-full font-bold">
                    Dream Company ⭐
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-400">
                <span className="flex items-center gap-1.5 font-medium text-gray-300">
                  <Building2 className="w-4 h-4 text-gray-500" /> {job.company}
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-gray-500" /> {job.isRemote ? 'Remote' : job.location}
                </span>
                {job.salaryRaw && (
                  <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                    <DollarSign className="w-4 h-4" /> {job.salaryRaw}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center sm:flex-row gap-3 shrink-0 self-end md:self-start">
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-gray-800 text-gray-300 hover:border-gray-700 hover:text-white rounded-lg transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" /> View Listing
              </a>
              {job.status === 'SCORED' && (
                <button
                  onClick={handleApprove}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-lg shadow-blue-600/10 active:scale-95 transition-all"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Approve Role
                </button>
              )}
              {job.status === 'APPROVED' && (
                <span className="px-3 py-1.5 bg-blue-600/15 border border-blue-600/30 text-blue-400 text-xs font-bold rounded-lg flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5" /> Approved
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Grid: Description vs AI Tools */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Job Description Card */}
        <Card className="lg:col-span-2 border-gray-800 bg-gray-950/40 backdrop-blur-md flex flex-col max-h-[600px]">
          <CardHeader className="border-b border-gray-900 pb-3">
            <CardTitle className="text-sm font-semibold text-gray-300">Job Description</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-4 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
            {job.description}
          </CardContent>
        </Card>

        {/* Right: AI Tools Tabs */}
        <div className="lg:col-span-3 space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-gray-950 border border-gray-800 p-1 rounded-lg">
              <TabsTrigger value="analysis" className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 hover:text-white transition-all">
                AI Fit Analysis
              </TabsTrigger>
              <TabsTrigger value="resume" className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-indigo-600 data-[state=active]:text-white text-gray-400 hover:text-white transition-all">
                Tailor Resume
              </TabsTrigger>
              <TabsTrigger value="cover-letter" className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-purple-600 data-[state=active]:text-white text-gray-400 hover:text-white transition-all">
                Cover Letter
              </TabsTrigger>
            </TabsList>

            {/* Analysis Content */}
            <TabsContent value="analysis" className="mt-4 space-y-4">
              <Card className="border-gray-800 bg-gray-950/40 backdrop-blur-md">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-white">
                    <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                    <span className="text-sm font-bold">{analysis?.verdict || 'Match Scored'}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  {/* Score Caps Warnings / Red Flags */}
                  {analysis?.redFlags && analysis.redFlags.length > 0 && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3.5 rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                        POTENTIAL RED FLAGS DETECTED (Score capped at 60)
                      </div>
                      <ul className="list-disc list-inside text-[11px] text-red-400/90 pl-1 space-y-0.5">
                        {analysis.redFlags.map((flag: string, i: number) => (
                          <li key={i}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Multi-Dimensional Breakdown */}
                  {analysis?.dimensions && (
                    <div className="bg-gray-950/60 p-4 border border-gray-900 rounded-xl space-y-3">
                      <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Scoring Breakdown</h3>
                      <div className="space-y-2.5">
                        {Object.entries(analysis.dimensions).map(([dim, score]) => (
                          <div key={dim} className="space-y-1">
                            <div className="flex justify-between text-[11px] font-semibold">
                              <span className="text-gray-400">{dimensionLabels[dim] || dim}</span>
                              <span className={clsx(
                                (score as number) >= 75 ? 'text-green-400' :
                                (score as number) >= 55 ? 'text-yellow-400' : 'text-red-400'
                              )}>{score as number}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-gray-900 rounded-full overflow-hidden border border-gray-900">
                              <div
                                className={clsx(
                                  'h-full rounded-full transition-all',
                                  (score as number) >= 75 ? 'bg-green-500' :
                                  (score as number) >= 55 ? 'bg-yellow-500' : 'bg-red-500'
                                )}
                                style={{ width: `${score}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Domain Relevance */}
                  {analysis?.domainRelevance && (
                    <div className="bg-gray-950/60 p-4 border border-gray-900 rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-gray-300">
                        <Info className="w-3.5 h-3.5 text-blue-400" />
                        DOMAIN RELEVANCE
                      </div>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        {analysis.domainRelevance}
                      </p>
                    </div>
                  )}

                  {/* Strengths & Gaps Row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Strengths */}
                    {analysis?.strengths && analysis.strengths.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Core Match Strengths</p>
                        <ul className="space-y-1.5">
                          {analysis.strengths.map((str: string, i: number) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-green-400">
                              <CheckCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-green-500" />
                              {str}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Gaps */}
                    {analysis?.gaps && analysis.gaps.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Requirements Gaps</p>
                        <ul className="space-y-1.5">
                          {analysis.gaps.map((gap: string, i: number) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-red-400">
                              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-500" />
                              {gap}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Why Apply & Why Skip */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-900 pt-3">
                    {analysis?.whyApply && (
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-gray-300 uppercase tracking-wider">Strongest Case to Apply</p>
                        <p className="text-xs text-gray-400 leading-relaxed">{analysis.whyApply}</p>
                      </div>
                    )}
                    {analysis?.whySkip && (
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-gray-300 uppercase tracking-wider">Reason to Skip</p>
                        <p className="text-xs text-gray-400 leading-relaxed">{analysis.whySkip}</p>
                      </div>
                    )}
                  </div>

                  {/* Recommendation */}
                  {analysis?.recommendation && (
                    <div className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-lg text-xs text-blue-400 italic font-medium">
                      {analysis.recommendation}
                    </div>
                  )}

                  {/* Tailoring actions */}
                  <div className="flex gap-3 pt-3 border-t border-gray-900">
                    <button
                      onClick={handleTailor}
                      disabled={tailoring}
                      className="flex items-center gap-2 px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold shadow-lg shadow-indigo-600/10 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {tailoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                      Tailor Resume
                    </button>
                    <button
                      onClick={handleGenerateCL}
                      disabled={generatingCL}
                      className="flex items-center gap-2 px-3 py-2 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold shadow-lg shadow-purple-600/10 active:scale-95 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {generatingCL ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                      Generate Cover Letter
                    </button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Resume Content */}
            <TabsContent value="resume" className="mt-4">
              <Card className="border-gray-800 bg-gray-950/40 backdrop-blur-md">
                <CardContent className="p-5 space-y-4">
                  {application?.tailoredResumeLatex ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-white">Tailored Resume (LaTeX Snippet)</p>
                        <span className="text-xs text-indigo-400 font-medium">
                          {application.changesSummary?.length || 0} changes made
                        </span>
                      </div>
                      {application.changesSummary && (
                        <div className="bg-gray-950 border border-gray-900 p-3 rounded-lg text-xs space-y-1 text-gray-400">
                          <p className="font-semibold text-gray-300">Modifications Summary:</p>
                          <ul className="list-disc list-inside space-y-0.5 pl-1">
                            {application.changesSummary.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <pre className="text-xs text-gray-300 bg-gray-950 p-4 rounded-lg overflow-auto max-h-80 font-mono border border-gray-900 leading-relaxed">
                        {application.tailoredResumeLatex.slice(0, 1500)}...
                      </pre>
                      <button
                        onClick={handleTailor}
                        disabled={tailoring}
                        className="flex items-center gap-2 px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {tailoring ? 'Re-Generating...' : 'Re-Tailor Resume'}
                      </button>
                    </>
                  ) : (
                    <div className="text-center py-12 space-y-4 border border-dashed border-gray-800 rounded-xl">
                      <Wand2 className="w-8 h-8 text-gray-600 mx-auto" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-gray-300">No tailored resume yet</p>
                        <p className="text-xs text-gray-500 max-w-xs mx-auto">
                          Automatically adapt your base LaTeX resume to highlight matching skills and project experiences for this job.
                        </p>
                      </div>
                      <button
                        onClick={handleTailor}
                        disabled={tailoring}
                        className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {tailoring ? 'Generating tailored resume...' : 'Generate Tailored Resume'}
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Cover Letter Content */}
            <TabsContent value="cover-letter" className="mt-4">
              <Card className="border-gray-800 bg-gray-950/40 backdrop-blur-md">
                <CardContent className="p-5 space-y-4">
                  {application?.coverLetter ? (
                    <>
                      <p className="text-sm font-semibold text-white mb-2">Generated Cover Letter</p>
                      <p className="text-xs text-gray-300 leading-relaxed bg-gray-950 p-4 rounded-lg border border-gray-900 whitespace-pre-wrap">
                        {application.coverLetter}
                      </p>
                      <button
                        onClick={handleGenerateCL}
                        disabled={generatingCL}
                        className="flex items-center gap-2 px-3 py-2 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {generatingCL ? 'Re-Generating...' : 'Re-Generate Cover Letter'}
                      </button>
                    </>
                  ) : (
                    <div className="text-center py-12 space-y-4 border border-dashed border-gray-800 rounded-xl">
                      <FileText className="w-8 h-8 text-gray-600 mx-auto" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-gray-300">No cover letter yet</p>
                        <p className="text-xs text-gray-500 max-w-xs mx-auto">
                          Generate a personalized, high-conversion cover letter detailing how your Samsung internship and distributed systems projects fit this JD.
                        </p>
                      </div>
                      <button
                        onClick={handleGenerateCL}
                        disabled={generatingCL}
                        className="px-4 py-2 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {generatingCL ? 'Generating cover letter...' : 'Generate Cover Letter'}
                      </button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
