'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { jobsApi } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import {
  Briefcase,
  TrendingUp,
  Send,
  RefreshCw,
  Zap,
  ArrowRight,
  BarChart3,
  Flame,
  Globe,
  Bell,
  Cpu,
  CheckCircle,
  Activity,
  AlertTriangle
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Stats {
  total: number;
  scored: number;
  approved: number;
  applied: number;
  today: number;
  avgFitScore: number;
  bySource: { source: string; count: number }[];
  topJobs: { id: string; title: string; company: string; fitScore: number; source: string }[];
  scraperHealth: Record<string, { state: string; failures: number }>;
}

const STAT_CARDS = [
  { key: 'today', label: 'Jobs Scraped Today', icon: Zap, color: 'text-indigo-400 bg-indigo-500/10' },
  { key: 'scored', label: 'Pending Review', icon: Briefcase, color: 'text-violet-400 bg-violet-500/10' },
  { key: 'approved', label: 'Approved Roles', icon: TrendingUp, color: 'text-emerald-400 bg-emerald-500/10' },
  { key: 'applied', label: 'Applications Sent', icon: Send, color: 'text-pink-400 bg-pink-500/10' },
] as const;

type StatKeys = 'today' | 'scored' | 'approved' | 'applied';

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [newJobsFlash, setNewJobsFlash] = useState<number | null>(null);
  const [liveTicker, setLiveTicker] = useState<any[]>([]);
  const [dreamAlerts, setDreamAlerts] = useState<any[]>([]);

  const loadStats = useCallback(async () => {
    try {
      const data = await jobsApi.stats();
      setStats(data);

      // Fetch recent scored jobs to seed ticker
      const recentScored = await jobsApi.list({ limit: 5, status: 'SCORED' });
      if (recentScored && recentScored.jobs) {
        setLiveTicker(recentScored.jobs.map((j: any) => ({
          jobId: j.id,
          title: j.title,
          company: j.company,
          fitScore: j.fitScore,
          verdict: j.fitAnalysis?.verdict || 'Awaiting Review'
        })));
      }

      // Fetch all scored target jobs for dream company alerts
      const targetJobs = await jobsApi.list({ limit: 15, status: 'SCORED' });
      if (targetJobs && targetJobs.jobs) {
        const filtered = targetJobs.jobs.filter((j: any) => j.fitAnalysis?.isTargetCompany === true || j.fitScore >= 85);
        setDreamAlerts(filtered);
      }
    } catch (err) {
      console.error('Failed to load stats', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Real-time listener: new jobs discovered
  useSocket('jobs:new', (data: any) => {
    setNewJobsFlash(data.count);
    setTimeout(() => setNewJobsFlash(null), 5000);
    loadStats();
  });

  // Real-time listener: job scored by Gemini
  useSocket('job:scored', (data: any) => {
    // data structure: { jobId, fitScore, fitAnalysis }
    // Fetch job details to get title/company or build it from analysis
    const title = data.fitAnalysis?.title || 'Software Engineer';
    const company = data.fitAnalysis?.company || 'Company';

    setLiveTicker((prev) => [
      {
        jobId: data.jobId,
        title,
        company,
        fitScore: data.fitScore,
        verdict: data.fitAnalysis?.verdict || 'Scored'
      },
      ...prev
    ].slice(0, 10));

    // If it's a target company or high score, add to alerts
    if (data.fitAnalysis?.isTargetCompany || data.fitScore >= 85) {
      setDreamAlerts((prev) => [
        {
          id: data.jobId,
          title,
          company,
          fitScore: data.fitScore,
          fitAnalysis: data.fitAnalysis
        },
        ...prev
      ].slice(0, 5));
    }

    loadStats(); // Refresh stats cards
  });

  const handleScrape = async () => {
    setScraping(true);
    try {
      await jobsApi.triggerScrape();
    } catch (err) {
      console.error('Failed to run scraper', err);
    } finally {
      setTimeout(() => setScraping(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-6xl mx-auto bg-background min-h-screen text-foreground font-sans">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // Calculate API usage stats (based on capacity of 15 requests per minute, 21,600 per day)
  const jobsScoredToday = stats?.today || 0;
  const geminiCapacityUsed = Math.min(100, Math.round((jobsScoredToday / 150) * 100)); // assume 150 target calls/day

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto bg-background min-h-screen text-foreground font-sans">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
            Pipeline Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            Welcome back, Rishav Sharma. Real-time updates from NIT Durgapur '26 automation hub.
          </p>
        </div>
      </div>

      {/* New jobs alert */}
      {newJobsFlash !== null && (
        <Alert className="border-primary/20 bg-primary/5 text-foreground rounded-xl">
          <Zap className="w-4 h-4 text-primary animate-bounce" />
          <AlertDescription className="text-xs">
            {newJobsFlash} new jobs discovered! Fit analysis running in background...
          </AlertDescription>
        </Alert>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {STAT_CARDS.map(({ key, label, icon: Icon, color }) => (
          <Card key={key} className="border-border bg-card/40 backdrop-blur-md hover:border-muted-foreground/20 transition-all duration-300">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
              <div className={`p-1.5 rounded-lg ${color}`}>
                <Icon className="w-4 h-4" />
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="text-3xl font-extrabold tracking-tight">
                {stats?.[key as StatKeys] ?? 0}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Grid: Analytical Stats & Live Ticker */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left 2 Cols: Stats, Distribution & Usage */}
        <div className="lg:col-span-2 space-y-6">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

            {/* Avg Fit Score */}
            <Card className="border-border bg-card/40 backdrop-blur-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Average Profile Fit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold text-primary">
                    {stats?.avgFitScore ?? 0}
                  </span>
                  <span className="text-muted-foreground text-xs font-semibold">/ 100</span>
                </div>

                <div className="space-y-1.5">
                  <Progress value={stats?.avgFitScore ?? 0} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                    <span>Low Fit (0)</span>
                    <span>Target: 65</span>
                    <span>High Fit (100)</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Gemini usage stats */}
            <Card className="border-border bg-card/40 backdrop-blur-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Gemini LLM Quota Rate</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-extrabold text-primary">
                    {geminiCapacityUsed}%
                  </span>
                  <span className="text-muted-foreground text-xs font-semibold">used today</span>
                </div>

                <div className="space-y-1.5">
                  <Progress value={geminiCapacityUsed} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                    <span>0 call</span>
                    <span>Limit: 15 RPM</span>
                    <span>150 calls</span>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>

          {/* Jobs by Source distribution */}
          <Card className="border-border bg-card/40 backdrop-blur-md">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Jobs Distribution by Source</CardTitle>
              </div>
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              {stats?.bySource && stats.bySource.length > 0 ? (
                stats.bySource.map(({ source, count }) => (
                  <div key={source} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="capitalize text-foreground">{source}</span>
                      <span className="text-muted-foreground">{count} jobs ({Math.round((count / (stats.total || 1)) * 100)}%)</span>
                    </div>
                    <Progress value={(count / (stats.total || 1)) * 100} className="h-1.5" />
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground py-4 text-center">No source distribution stats available yet.</p>
              )}
            </CardContent>
          </Card>

          {/* Scraper Run Logs / Circuits Health */}
          <Card className="border-border bg-card/40 backdrop-blur-md">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Scraper Health Logs</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {stats?.scraperHealth && Object.entries(stats.scraperHealth).slice(0, 8).map(([name, h]) => (
                  <div key={name} className="p-2 rounded-lg bg-muted/40 border border-border flex flex-col gap-1">
                    <span className="capitalize font-bold text-foreground">{name}</span>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${h.state === 'CLOSED' ? 'bg-emerald-500 animate-pulse' : 'bg-destructive'}`} />
                      <span className="text-[10px] text-muted-foreground font-medium">{h.state === 'CLOSED' ? 'Healthy' : 'Tripped'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

        </div>

        {/* Right Pane: Live Ticker & Dream Company Alerts */}
        <div className="space-y-6">

          {/* Dream Company Alerts */}
          {dreamAlerts.length > 0 && (
            <Card className="border-primary/25 bg-primary/5 backdrop-blur-md shadow-lg animate-pulse">
              <CardHeader className="pb-2 flex flex-row items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-primary">Dream Company Alerts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                {dreamAlerts.slice(0, 3).map((job) => (
                  <div key={job.id} className="text-xs border-b border-border pb-2 last:border-0 last:pb-0">
                    <div className="flex justify-between items-center">
                      <span className="font-extrabold text-foreground uppercase truncate max-w-[140px]">{job.company}</span>
                      <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px] px-1.5">{job.fitScore}% Fit</Badge>
                    </div>
                    <p className="text-foreground text-[11px] truncate mt-1">{job.title}</p>
                    <Link href={`/jobs?search=${job.company}`} className="text-[10px] text-primary hover:underline mt-1.5 inline-flex items-center gap-0.5 font-semibold">
                      Review Job <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Live Scoring Ticker */}
          <Card className="border-border bg-card/40 backdrop-blur-md">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-primary animate-pulse" />
                  Live Scoring Ticker
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <ScrollArea className="max-h-[360px]">
                <div className="space-y-4 pr-2">
                  <div className="flex flex-col gap-4">
                    {liveTicker.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-6 text-center italic">Awaiting live scoring events...</p>
                    ) : (
                      liveTicker.map((item, idx) => (
                        <div
                          key={`${item.jobId}-${idx}`}
                          className="p-2.5 rounded-lg bg-muted/40 border border-border flex justify-between items-start gap-2 animate-in fade-in slide-in-from-left-2 duration-300"
                        >
                          <div className="space-y-1 min-w-0">
                            <p className="font-extrabold text-[10px] text-muted-foreground uppercase truncate">{item.company}</p>
                            <p className="font-bold text-xs text-foreground truncate">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground truncate italic">{item.verdict}</p>
                          </div>
                          <Badge className={`text-[10px] font-bold px-1.5 shrink-0 ${item.fitScore >= 80
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : item.fitScore >= 60
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                            }`}>
                            {item.fitScore}%
                          </Badge>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

        </div>

      </div>

      {/* Quick Access links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link href="/jobs?status=SCORED">
          <Card className="border-border bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-300 cursor-pointer group">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Review Scored Jobs</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.scored || 0} jobs awaiting approval.
                </p>
              </div>
              <Button variant="outline" size="icon" className="shrink-0 border-border hover:bg-muted cursor-pointer">
                <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </Link>

        <Link href="/onboarding">
          <Card className="border-border bg-card/30 hover:bg-card/50 hover:border-border transition-all duration-300 cursor-pointer group">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Onboarding Wizard</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Recalibrate profile and seed the AnswerBank.
                </p>
              </div>
              <Button variant="outline" size="icon" className="shrink-0 border-border hover:bg-muted cursor-pointer">
                <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </Link>
      </div>

    </div>
  );
}
