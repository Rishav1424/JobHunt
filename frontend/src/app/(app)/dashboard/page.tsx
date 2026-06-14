'use client';

import { useEffect, useState, useCallback } from 'react';
import { jobsApi } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import {
  Briefcase, TrendingUp, Send,
  RefreshCw, Zap, ArrowRight, BarChart3
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

interface Stats {
  total: number;
  scored: number;
  approved: number;
  applied: number;
  today: number;
  avgFitScore: number;
  bySource: { source: string; count: number }[];
}

const STAT_CARDS = [
  {
    key: 'today', label: 'Jobs Scraped Today', icon: Zap,
  },
  {
    key: 'scored', label: 'Pending Review', icon: Briefcase,
  },
  {
    key: 'approved', label: 'Approved Roles', icon: TrendingUp,
  },
  {
    key: 'applied', label: 'Applications Sent', icon: Send,
  },
] as const;

type StatKeys = 'today' | 'scored' | 'approved' | 'applied';

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [newJobsFlash, setNewJobsFlash] = useState<number | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await jobsApi.stats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // Real-time: new jobs discovered
  useSocket('jobs:new', (data: unknown) => {
    const { count } = data as { count: number };
    setNewJobsFlash(count);
    setTimeout(() => setNewJobsFlash(null), 5000);
    loadStats();
  });

  const handleScrape = async () => {
    setScraping(true);
    try {
      await jobsApi.triggerScrape();
    } finally {
      setTimeout(() => setScraping(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
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

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Welcome back, Rishav. Your automated job hunt pipeline status.
          </p>
        </div>
        <Button onClick={handleScrape} disabled={scraping}>
          <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
          {scraping ? 'Running Scraper...' : 'Run Scrape Now'}
        </Button>
      </div>

      {/* New jobs alert */}
      {newJobsFlash !== null && (
        <Alert>
          <Zap className="w-4 h-4" />
          <AlertDescription>
            {newJobsFlash} new jobs discovered! Analyzing fit and compensation benchmarks with Gemini...
          </AlertDescription>
        </Alert>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ key, label, icon: Icon }) => (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
              <Icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight">
                {stats?.[key as StatKeys] ?? 0}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Avg fit score */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Average Fit Score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-extrabold">
                {stats?.avgFitScore ?? 0}
              </span>
              <span className="text-muted-foreground text-sm font-semibold">/ 100</span>
            </div>
            
            <div className="space-y-1">
              <Progress value={stats?.avgFitScore ?? 0} className="h-2.5" />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>0</span>
                <span>Threshold: 65</span>
                <span>100</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Based on your calibrated preferences. Active filters target Software Engineer / Backend roles offering ₹15 LPA+.
            </p>
          </CardContent>
        </Card>

        {/* Jobs by source */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Jobs by Source</CardTitle>
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            {stats?.bySource && stats.bySource.length > 0 ? (
              stats.bySource.map(({ source, count }) => (
                <div key={source} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="capitalize">{source}</span>
                    <span className="text-muted-foreground">{count} ({Math.round((count / (stats.total || 1)) * 100)}%)</span>
                  </div>
                  <Progress value={(count / (stats.total || 1)) * 100} className="h-2" />
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground py-4 text-center">No source distribution stats available yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/jobs?status=SCORED">
          <Card className="hover:bg-accent transition-colors cursor-pointer group">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold group-hover:text-accent-foreground transition-colors">Review Scored Jobs</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.scored || 0} jobs awaiting your manual approval/skip decision.
                </p>
              </div>
              <Button variant="outline" size="icon" className="shrink-0">
                <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </Link>

        <Link href="/applications?status=PENDING">
          <Card className="hover:bg-accent transition-colors cursor-pointer group">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold group-hover:text-accent-foreground transition-colors">Prepare Applications</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.approved || 0} approved roles ready for resume tailoring and cover letter generation.
                </p>
              </div>
              <Button variant="outline" size="icon" className="shrink-0">
                <ArrowRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
