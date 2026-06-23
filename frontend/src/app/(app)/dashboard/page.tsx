'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { jobsApi, settingsApi } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import {
  Briefcase,
  TrendingUp,
  Send,
  Zap,
  ArrowRight,
  BarChart3,
  Bell,
  Cpu,
  CheckCircle,
  AlertTriangle,
  Award,
  PieChart as PieIcon,
  LineChart as LineIcon
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell
} from 'recharts';

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
  { key: 'total', label: 'Total Scraped', icon: Briefcase, color: 'text-blue-400 bg-blue-500/10' },
  { key: 'today', label: 'Scraped Today', icon: Zap, color: 'text-indigo-400 bg-indigo-500/10' },
  { key: 'scored', label: 'Pending Review', icon: Cpu, color: 'text-violet-400 bg-violet-500/10' },
  { key: 'approved', label: 'Approved Roles', icon: CheckCircle, color: 'text-emerald-400 bg-emerald-500/10' },
  { key: 'applied', label: 'Applications Sent', icon: Send, color: 'text-pink-400 bg-pink-500/10' },
  { key: 'conversion', label: 'Conversion Rate', icon: TrendingUp, color: 'text-amber-400 bg-amber-500/10' },
] as const;

type StatKeys = 'total' | 'today' | 'scored' | 'approved' | 'applied' | 'conversion';

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#10b981', '#f59e0b', '#06b6d4', '#64748b'];

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [newJobsFlash, setNewJobsFlash] = useState<number | null>(null);
  const [dreamAlerts, setDreamAlerts] = useState<any[]>([]);
  
  // Analytics State
  const [distribution, setDistribution] = useState<{ name: string; count: number }[]>([]);
  const [funnelData, setFunnelData] = useState<{ name: string; value: number }[]>([]);
  const [threshold, setThreshold] = useState<number>(65);
  const [isMounted, setIsMounted] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const [statsData, settingsData, targetJobs, jobsData] = await Promise.all([
        jobsApi.stats(),
        settingsApi.get().catch(() => ({ fitScoreThreshold: 65 })),
        jobsApi.list({ limit: 15, status: 'SCORED' }),
        jobsApi.list({ limit: 500 }),
      ]);

      setStats(statsData);
      setThreshold(settingsData.fitScoreThreshold);

      // Funnel data
      setFunnelData([
        { name: 'Scraped', value: statsData.total },
        { name: 'Scored', value: statsData.scored + statsData.approved + statsData.applied },
        { name: 'Approved', value: statsData.approved + statsData.applied },
        { name: 'Applied', value: statsData.applied },
      ]);

      // Dream alerts
      if (targetJobs && targetJobs.jobs) {
        const filtered = targetJobs.jobs.filter((j: any) => j.fitAnalysis?.isTargetCompany === true || j.fitScore >= 85);
        setDreamAlerts(filtered);
      }

      // Score distribution
      if (jobsData && jobsData.jobs) {
        const scoredJobs = jobsData.jobs.filter((j: any) => j.fitScore !== undefined && j.fitScore > 0);
        const bins = [
          { name: '0-20', count: 0 },
          { name: '21-40', count: 0 },
          { name: '41-60', count: 0 },
          { name: '61-80', count: 0 },
          { name: '81-100', count: 0 },
        ];

        scoredJobs.forEach((j: any) => {
          const score = j.fitScore;
          if (score <= 20) bins[0].count++;
          else if (score <= 40) bins[1].count++;
          else if (score <= 60) bins[2].count++;
          else if (score <= 80) bins[3].count++;
          else bins[4].count++;
        });
        setDistribution(bins);
      }
    } catch (err) {
      console.error('Failed to load dashboard data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
    loadStats();
  }, [loadStats]);

  // Real-time listener: new jobs discovered
  useSocket('jobs:new', (data: any) => {
    setNewJobsFlash(data.count);
    setTimeout(() => setNewJobsFlash(null), 5000);
    loadStats();
  });

  // Real-time listener: job scored by Gemini (causes dashboard charts/metrics refresh)
  useSocket('job:scored', (data: any) => {
    loadStats();
  });

  if (loading || !isMounted) {
    return (
      <div className="p-6 space-y-6 max-w-6xl mx-auto bg-background min-h-screen text-foreground font-sans">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  // Calculate API usage stats (based on capacity of 15 requests per minute, 21,600 per day)
  const jobsScoredToday = stats?.today || 0;
  const geminiCapacityUsed = Math.min(100, Math.round((jobsScoredToday / 150) * 100)); // assume 150 target calls/day

  const getStatValue = (key: string): number => {
    if (!stats) return 0;
    if (key === 'conversion') {
      return stats.total ? Math.round(((stats.approved + stats.applied) / stats.total) * 100) : 0;
    }
    const val = stats[key as keyof Stats];
    return typeof val === 'number' ? val : 0;
  };

  const sourceChartData = stats?.bySource.map(({ source, count }) => ({
    name: source.charAt(0).toUpperCase() + source.slice(1),
    Jobs: count,
  })) || [];

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto bg-background min-h-screen text-foreground font-sans">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
            Pipeline Dashboard & Analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            Welcome back, Rishav Sharma. Real-time metrics and pipeline insights from NIT Durgapur '26 automation hub.
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
        {STAT_CARDS.map(({ key, label, icon: Icon, color }) => (
          <Card key={key} className="bg-card/40 backdrop-blur-md">
            <CardContent className="p-4">
              <CardTitle className="text-xs font-bold uppercase tracking-tight md:tracking-wider text-muted-foreground">{label}</CardTitle>
              <div className="flex gap-4 mt-4 items-center">
                <Icon className={`size-8 p-1.5 rounded-lg shrink-0 ${color}`} />
                <div className="text-2xl font-extrabold tracking-tight">
                  {getStatValue(key)}{key === 'conversion' && '%'}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Two-Column Grid Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column (Main - 2/3 Width): Charts & Calibrations */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pipeline Calibration & Filter Health */}
          <Card className="border border-border/80 bg-linear-to-r from-primary/5 via-card/40 to-muted/5 backdrop-blur-md shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
                <Award className="h-4.5 w-4.5" /> Pipeline Calibration & Filter Health
              </CardTitle>
              <CardDescription className="text-xs">
                Review how your profile fit threshold matches scraped job quality distribution.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2 pb-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-semibold">Active Filter Threshold</span>
                  <p className="text-3xl font-extrabold">{threshold}% Match</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">
                    Jobs scoring below this threshold are skipped during ingestion.
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground font-semibold">Average Scored Fit</span>
                  <p className={`text-3xl font-extrabold ${(stats?.avgFitScore ?? 0) >= threshold ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {stats?.avgFitScore ?? 0}% Match
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">
                    Average score computed by Gemini across all active and scored job descriptions.
                  </p>
                </div>
                <div className="p-3.5 rounded-xl border border-border/40 bg-muted/20 text-xs leading-relaxed space-y-1">
                  <span className="font-bold flex items-center gap-1 text-foreground">
                    {Math.abs((stats?.avgFitScore ?? 0) - threshold) <= 10 ? (
                      <>
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> System Well Calibrated
                      </>
                    ) : (stats?.avgFitScore ?? 0) > threshold ? (
                      <>
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-400 animate-pulse" /> High Yield Calibration
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 animate-pulse" /> Calibration Drift Detected
                      </>
                    )}
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-normal">
                    {(stats?.avgFitScore ?? 0) > threshold + 15
                      ? 'Your profile average is significantly higher than the threshold. You are in a target-rich pipeline with high approval rates.'
                      : (stats?.avgFitScore ?? 0) < threshold - 5
                      ? 'Your profile average is below the threshold. Scraped listings might be skipped frequently. Consider updating target roles or skills in settings.'
                      : 'Your threshold is in sync with listing averages. Scrapers are correctly targeting relevant roles for your profile.'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recharts Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Fit Score Distribution Area Chart */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <LineIcon className="w-4 h-4 text-muted-foreground" /> Fit Score Distribution
                </CardTitle>
                <CardDescription>Jobs grouped by matching percentage bands.</CardDescription>
              </CardHeader>
              <CardContent className="h-64 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={distribution} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 10 }} />
                    <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: 8, fontSize: 11, color: 'hsl(var(--popover-foreground))' }} />
                    <Area type="monotone" dataKey="count" name="Jobs" stroke="hsl(var(--chart-1))" strokeWidth={2} fillOpacity={1} fill="url(#colorCount)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Jobs by Source Bar Chart */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <PieIcon className="w-4 h-4 text-muted-foreground" /> Jobs by Source
                </CardTitle>
                <CardDescription>Listing volume breakdown by scraper channels.</CardDescription>
              </CardHeader>
              <CardContent className="h-64 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" style={{ fontSize: 10 }} />
                    <YAxis stroke="hsl(var(--muted-foreground))" style={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: 8, fontSize: 11, color: 'hsl(var(--popover-foreground))' }} />
                    <Bar dataKey="Jobs" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]}>
                      {sourceChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Jobs by Source distribution */}
          <Card className="bg-card/40 backdrop-blur-md">
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
        </div>

        {/* Right Column (Sidebar - 1/3 Width): Stats & Alerts */}
        <div className="space-y-6">
          {/* Avg Fit Score */}
          <Card className="bg-card/40 backdrop-blur-md">
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
          <Card className="bg-card/40 backdrop-blur-md">
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

          {/* Dream Company Alerts */}
          {dreamAlerts.length > 0 && (
            <Card className="border-primary/25 bg-primary/5 backdrop-blur-md shadow-lg">
              <CardHeader className="pb-2 flex flex-row items-center gap-2">
                <Bell className="h-4 w-4 text-primary animate-pulse" />
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-primary">Dream Company Alerts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-2">
                {dreamAlerts.slice(0, 3).map((job) => (
                  <div key={job.id} className="text-xs border-b pb-2 last:border-0 last:pb-0">
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

          {/* Quick Access links */}
          <div className="flex flex-col gap-4">
            <Link href="/jobs?status=SCORED">
              <Card className="bg-card/30 hover:bg-card/50 hover:transition-all duration-300 cursor-pointer group">
                <CardContent className="flex items-center justify-between p-6">
                  <div>
                    <p className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Review Scored Jobs</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {stats?.scored || 0} jobs awaiting approval.
                    </p>
                  </div>
                  <Button variant="outline" size="icon" className="shrink-0 hover:bg-muted cursor-pointer">
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            </Link>

            <Link href="/onboarding">
              <Card className="bg-card/30 hover:bg-card/50 hover:transition-all duration-300 cursor-pointer group">
                <CardContent className="flex items-center justify-between p-6">
                  <div>
                    <p className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">Onboarding Wizard</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Recalibrate profile and seed the AnswerBank.
                    </p>
                  </div>
                  <Button variant="outline" size="icon" className="shrink-0 hover:bg-muted cursor-pointer">
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>

      </div>

    </div>
  );
}
