'use client';

import { useEffect, useState, useCallback } from 'react';
import { jobsApi } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import {
  Briefcase, TrendingUp, CheckCircle, Send,
  RefreshCw, Zap, ArrowRight
} from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';

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
    key: 'today', label: 'Jobs Today', icon: Zap,
    color: 'text-blue-400', bg: 'bg-blue-600/10 border-blue-600/20',
  },
  {
    key: 'scored', label: 'Pending Review', icon: Briefcase,
    color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20',
  },
  {
    key: 'approved', label: 'Approved', icon: TrendingUp,
    color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20',
  },
  {
    key: 'applied', label: 'Applied', icon: Send,
    color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20',
  },
];

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
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Welcome back, Rishav. Your job hunt at a glance.
          </p>
        </div>
        <button
          onClick={handleScrape}
          disabled={scraping}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            scraping
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          )}
        >
          <RefreshCw className={clsx('w-4 h-4', scraping && 'animate-spin')} />
          {scraping ? 'Scraping...' : 'Run Scrape Now'}
        </button>
      </div>

      {/* New jobs toast */}
      {newJobsFlash !== null && (
        <div className="bg-green-500/15 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg text-sm flex items-center gap-2 animate-pulse">
          <Zap className="w-4 h-4" />
          {newJobsFlash} new jobs found! Scoring with Gemini...
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ key, label, icon: Icon, color, bg }) => (
          <div key={key} className={clsx('glass rounded-xl p-4 border', bg)}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-400">{label}</span>
              <Icon className={clsx('w-4 h-4', color)} />
            </div>
            <p className={clsx('text-2xl font-bold', color)}>
              {stats?.[key as keyof Stats] ?? 0}
            </p>
          </div>
        ))}
      </div>

      {/* Secondary row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Avg fit score */}
        <div className="glass rounded-xl p-5 border border-gray-800">
          <p className="text-xs text-gray-400 mb-1">Avg Fit Score</p>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-bold text-white">
              {stats?.avgFitScore ?? 0}
            </p>
            <p className="text-gray-500 text-sm mb-1">/ 100</p>
          </div>
          {/* Score bar */}
          <div className="mt-3 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-1000',
                (stats?.avgFitScore || 0) >= 75 ? 'bg-green-500' :
                (stats?.avgFitScore || 0) >= 55 ? 'bg-yellow-500' : 'bg-red-500'
              )}
              style={{ width: `${stats?.avgFitScore || 0}%` }}
            />
          </div>
        </div>

        {/* Jobs by source */}
        <div className="glass rounded-xl p-5 border border-gray-800 col-span-2">
          <p className="text-xs text-gray-400 mb-3">Jobs by Source</p>
          <div className="space-y-2">
            {stats?.bySource.map(({ source, count }) => (
              <div key={source} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-20 capitalize">{source}</span>
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${(count / (stats.total || 1)) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/jobs?status=SCORED"
          className="glass rounded-xl p-5 border border-gray-800 hover:border-blue-600/30 transition-all group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Review Jobs</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {stats?.scored || 0} jobs awaiting your review
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
          </div>
        </Link>

        <Link href="/applications?status=APPROVED"
          className="glass rounded-xl p-5 border border-gray-800 hover:border-blue-600/30 transition-all group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Ready to Apply</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {stats?.approved || 0} approved jobs waiting
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-blue-400 transition-colors" />
          </div>
        </Link>
      </div>
    </div>
  );
}
