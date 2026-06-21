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
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

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

  const analysis = job.fitAnalysis;
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
      <Link href="/jobs" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
        <ArrowLeft className="w-4 h-4" /> Back to Job Queue
      </Link>

      {/* Job Header Card */}
      <Card className="border-border bg-card/40 backdrop-blur-md">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="flex-1 min-w-0">
              <div className="flex items-center flex-wrap gap-3 mb-2">
                <h1 className="text-2xl font-bold text-foreground tracking-tight leading-none">{job.title}</h1>
                {job.fitScore !== undefined && (
                  <div className={`badge-score ${scoreClass} text-sm`}>{job.fitScore}% Match</div>
                )}
                {analysis?.isTargetCompany && (
                  <span className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-xs px-2.5 py-0.5 rounded-full font-bold">
                    Dream Company ⭐
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Building2 className="w-4 h-4 text-muted-foreground" /> {job.company}
                </span>
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-muted-foreground" /> {job.isRemote ? 'Remote' : job.location}
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
              {(() => {
                let applyUrl = job.url;
                try {
                  const urlObj = new URL(job.applyUrl || job.url);
                  urlObj.searchParams.set('__jh', job.id);
                  applyUrl = urlObj.toString();
                } catch {}
                return (
                  <a
                    href={applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold border border-border text-foreground hover:bg-muted rounded-lg transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> View Listing
                  </a>
                );
              })()}
              {job.status === 'SCORED' && (
                <Button
                  onClick={handleApprove}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs h-8 cursor-pointer font-bold"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Approve Role
                </Button>
              )}
              {job.status === 'APPROVED' && (
                <span className="px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary text-xs font-bold rounded-lg flex items-center gap-1.5">
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
        <Card className="lg:col-span-2 border-border bg-card/40 backdrop-blur-md flex flex-col max-h-[600px]">
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm font-semibold text-foreground">Job Description</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-4 flex flex-col">
            <ScrollArea className="flex-1">
              <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                {job.description}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right: AI Tools Tabs */}
        <div className="lg:col-span-3 space-y-4">
          <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v as any)} className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-muted border border-border p-0.5 rounded-lg">
              <TabsTrigger value="analysis" className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground text-muted-foreground hover:text-foreground transition-all">
                AI Fit Analysis
              </TabsTrigger>
              <TabsTrigger value="resume" className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground text-muted-foreground hover:text-foreground transition-all">
                Tailor Resume
              </TabsTrigger>
              <TabsTrigger value="cover-letter" className="text-xs font-semibold px-3 py-1.5 rounded-md data-[state=active]:bg-background data-[state=active]:text-foreground text-muted-foreground hover:text-foreground transition-all">
                Cover Letter
              </TabsTrigger>
            </TabsList>

            {/* Analysis Content */}
            <TabsContent value="analysis" className="mt-4 space-y-4">
              <Card className="border-border bg-card/40 backdrop-blur-md">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-foreground">
                    <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                    <span className="text-sm font-bold">{analysis?.verdict || 'Match Scored'}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-2">
                  {/* Score Caps Warnings / Red Flags */}
                  {analysis?.redFlags && analysis.redFlags.length > 0 && (
                    <div className="bg-destructive/10 border border-destructive/20 text-destructive p-3.5 rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-destructive" />
                        POTENTIAL RED FLAGS DETECTED (Score capped at 60)
                      </div>
                      <ul className="list-disc list-inside text-[11px] text-destructive/90 pl-1 space-y-0.5">
                        {analysis.redFlags.map((flag: string, i: number) => (
                          <li key={i}>{flag}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Multi-Dimensional Breakdown */}
                  {analysis?.dimensions && (
                    <div className="bg-muted/60 p-4 border border-border rounded-xl space-y-3">
                      <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Scoring Breakdown</h3>
                      <div className="space-y-2.5">
                        {Object.entries(analysis.dimensions).map(([dim, score]) => (
                          <div key={dim} className="space-y-1">
                            <div className="flex justify-between text-[11px] font-semibold">
                              <span className="text-muted-foreground">{dimensionLabels[dim] || dim}</span>
                              <span className={clsx(
                                (score as number) >= 75 ? 'text-green-400' :
                                  (score as number) >= 55 ? 'text-yellow-400' : 'text-red-400'
                              )}>{score as number}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-background rounded-full overflow-hidden border border-border">
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
                    <div className="bg-muted/60 p-4 border border-border rounded-xl space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                        <Info className="w-3.5 h-3.5 text-primary" />
                        DOMAIN RELEVANCE
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {analysis.domainRelevance}
                      </p>
                    </div>
                  )}

                  {/* Strengths & Gaps Row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Strengths */}
                    {analysis?.strengths && analysis.strengths.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Core Match Strengths</p>
                        <ul className="space-y-1.5">
                          {analysis.strengths.map((str: string, i: number) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-green-450">
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
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Requirements Gaps</p>
                        <ul className="space-y-1.5">
                          {analysis.gaps.map((gap: string, i: number) => (
                            <li key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-destructive" />
                              {gap}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Why Apply & Why Skip */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-3">
                    {analysis?.whyApply && (
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-foreground uppercase tracking-wider">Strongest Case to Apply</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{analysis.whyApply}</p>
                      </div>
                    )}
                    {analysis?.whySkip && (
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-foreground uppercase tracking-wider">Reason to Skip</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{analysis.whySkip}</p>
                      </div>
                    )}
                  </div>

                  {/* Recommendation */}
                  {analysis?.recommendation && (
                    <div className="bg-primary/5 border border-primary/10 p-3 rounded-lg text-xs text-primary italic font-medium">
                      {analysis.recommendation}
                    </div>
                  )}

                  {/* Tailoring actions */}
                  <div className="flex gap-3 pt-3 border-t border-border">
                    <Button
                      onClick={handleTailor}
                      disabled={tailoring}
                      className="cursor-pointer"
                    >
                      {tailoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                      Tailor Resume
                    </Button>
                    <Button
                      onClick={handleGenerateCL}
                      disabled={generatingCL}
                      variant="secondary"
                      className="cursor-pointer"
                    >
                      {generatingCL ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                      Generate Cover Letter
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Resume Content */}
            <TabsContent value="resume" className="mt-4">
              <Card className="border-border bg-card/40 backdrop-blur-md">
                <CardContent className="p-5 space-y-4">
                  {application?.tailoredResumeLatex ? (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-foreground">Tailored Resume (LaTeX Snippet)</p>
                        <span className="text-xs text-primary font-medium">
                          {application.changesSummary?.length || 0} changes made
                        </span>
                      </div>
                      {application.changesSummary && (
                        <div className="bg-muted border border-border p-3 rounded-lg text-xs space-y-1 text-muted-foreground">
                          <p className="font-semibold text-foreground">Modifications Summary:</p>
                          <ul className="list-disc list-inside space-y-0.5 pl-1">
                            {application.changesSummary.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <ScrollArea className="max-h-80">
                        <pre className="text-xs text-muted-foreground bg-muted p-4 rounded-lg font-mono border border-border leading-relaxed whitespace-pre-wrap">
                          {application.tailoredResumeLatex.slice(0, 1500)}...
                        </pre>
                      </ScrollArea>
                      <Button
                        onClick={handleTailor}
                        disabled={tailoring}
                        className="cursor-pointer"
                      >
                        {tailoring ? 'Re-Generating...' : 'Re-Tailor Resume'}
                      </Button>
                    </>
                  ) : (
                    <div className="text-center py-12 space-y-4 border border-dashed border-border rounded-xl">
                      <Wand2 className="w-8 h-8 text-muted-foreground mx-auto" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">No tailored resume yet</p>
                        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                          Automatically adapt your base LaTeX resume to highlight matching skills and project experiences for this job.
                        </p>
                      </div>
                      <Button
                        onClick={handleTailor}
                        disabled={tailoring}
                        className="cursor-pointer"
                      >
                        {tailoring ? 'Generating tailored resume...' : 'Generate Tailored Resume'}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Cover Letter Content */}
            <TabsContent value="cover-letter" className="mt-4">
              <Card className="border-border bg-card/40 backdrop-blur-md">
                <CardContent className="p-5 space-y-4">
                  {application?.coverLetter ? (
                    <>
                      <p className="text-sm font-semibold text-foreground mb-2">Generated Cover Letter</p>
                      <p className="text-xs text-muted-foreground leading-relaxed bg-muted p-4 rounded-lg border border-border whitespace-pre-wrap">
                        {application.coverLetter}
                      </p>
                      <Button
                        onClick={handleGenerateCL}
                        disabled={generatingCL}
                        variant="secondary"
                        className="cursor-pointer"
                      >
                        {generatingCL ? 'Re-Generating...' : 'Re-Generate Cover Letter'}
                      </Button>
                    </>
                  ) : (
                    <div className="text-center py-12 space-y-4 border border-dashed border-border rounded-xl">
                      <FileText className="w-8 h-8 text-muted-foreground mx-auto" />
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">No cover letter yet</p>
                        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                          Generate a personalized, high-conversion cover letter detailing how your Samsung internship and distributed systems projects fit this JD.
                        </p>
                      </div>
                      <Button
                        onClick={handleGenerateCL}
                        disabled={generatingCL}
                        variant="secondary"
                        className="cursor-pointer"
                      >
                        {generatingCL ? 'Generating cover letter...' : 'Generate Cover Letter'}
                      </Button>
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
