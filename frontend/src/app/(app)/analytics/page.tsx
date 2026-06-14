'use client';

import { useEffect, useState } from 'react';
import { jobsApi } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell
} from 'recharts';
import {
  Briefcase, Zap, Send, Award, PieChart as PieIcon, LineChart as LineIcon
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
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

const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#10b981', '#f59e0b', '#06b6d4', '#64748b'];

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [distribution, setDistribution] = useState<{ name: string; count: number }[]>([]);
  const [funnelData, setFunnelData] = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    async function loadData() {
      try {
        const statsData = await jobsApi.stats();
        setStats(statsData);

        // Funnel data
        setFunnelData([
          { name: 'Scraped', value: statsData.total },
          { name: 'Scored', value: statsData.scored + statsData.approved + statsData.applied },
          { name: 'Approved', value: statsData.approved + statsData.applied },
          { name: 'Applied', value: statsData.applied },
        ]);

        // Get score distribution from real jobs
        const jobsData = await jobsApi.list({ limit: 500 });
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
      } catch (err) {
        console.error('Failed to load analytics', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading || !isMounted) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  // Format source stats for recharts
  const sourceChartData = stats?.bySource.map(({ source, count }) => ({
    name: source.charAt(0).toUpperCase() + source.slice(1),
    Jobs: count,
  })) || [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of pipeline metrics, source performance, and fit score distribution.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Scraped</CardTitle>
            <Briefcase className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scraped Today</CardTitle>
            <Zap className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.today ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avg Fit Score</CardTitle>
            <Award className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.avgFitScore ?? 0}%</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conversion Rate</CardTitle>
            <Send className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.total ? Math.round(((stats.approved + stats.applied) / stats.total) * 100) : 0}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recharts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
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

        {/* Funnel chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-semibold">Application Pipeline Funnel</CardTitle>
            <CardDescription>Retention volume along each stage of the funnel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            {funnelData.map(({ name, value }) => {
              const maxVal = stats?.total || 1;
              const pct = Math.round((value / maxVal) * 100);
              return (
                <div key={name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold">{name}</span>
                    <span className="text-muted-foreground font-semibold">{value} ({pct}%)</span>
                  </div>
                  <Progress value={pct} className="h-3" />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
