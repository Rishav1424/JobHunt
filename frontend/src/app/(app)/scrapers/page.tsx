'use client';

import React, { useState, useEffect, useRef } from 'react';
import { jobsApi } from '@/lib/api';
import { useSocket } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  Play,
  RotateCcw,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Shield,
  HelpCircle,
  Clock,
  Terminal,
  Trash2,
  Pause,
  Search,
  ChevronDown,
  ChevronUp,
  Cpu
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';

interface ScraperHealth {
  state: 'CLOSED' | 'OPEN' | 'HALF-OPEN';
  failures: number;
  openedAt?: number;
}

export default function ScrapersPage() {
  const [scrapers, setScrapers] = useState<Record<string, ScraperHealth>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Real-time log and worker status states
  const [logs, setLogs] = useState<any[]>([]);
  const [scrapingStatus, setScrapingStatus] = useState<any>({ status: 'idle' });
  const [scoringStatus, setScoringStatus] = useState<any>({ status: 'idle' });
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [levelFilter, setLevelFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // Socket listeners for real-time logs and statuses
  useSocket('system:log', (log: any) => {
    if (!isPaused) {
      setLogs((prev) => [...prev.slice(-399), log]);
    }
  });

  useSocket('scraping:status', (status: any) => {
    setScrapingStatus(status);
    if (status.status === 'completed' || status.status === 'failed') {
      setTimeout(() => {
        setScrapingStatus((prev: any) => prev.timestamp === status.timestamp ? { status: 'idle' } : prev);
      }, 10000);
      fetchHealth();
    }
  });

  useSocket('scoring:status', (status: any) => {
    setScoringStatus(status);
    if (status.status === 'completed' || status.status === 'failed') {
      setTimeout(() => {
        setScoringStatus((prev: any) => prev.timestamp === status.timestamp ? { status: 'idle' } : prev);
      }, 10000);
    }
  });

  useEffect(() => {
    if (autoScroll && !terminalCollapsed) {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, terminalCollapsed, autoScroll]);

  const fetchHealth = async () => {
    try {
      const response = await jobsApi.stats();
      if (response && response.scraperHealth) {
        setScrapers(response.scraperHealth);
      }
    } catch (err) {
      console.error('Failed to fetch scraper health', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleReset = async (name: string) => {
    setActionLoading(`reset-${name}`);
    try {
      await jobsApi.resetScraperCircuit(name);
      toast.success(`Circuit breaker for ${name} scraper reset successfully.`);
      await fetchHealth();
    } catch (err) {
      console.error(`Failed to reset scraper ${name}`, err);
      toast.error(`Failed to reset circuit breaker for ${name}.`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleTrigger = async (name?: string) => {
    const key = name ? `trigger-${name}` : 'trigger-all';
    setActionLoading(key);
    try {
      await jobsApi.triggerScrape(name);
      toast.success(name ? `Scraping queued for ${name}` : 'Scraping queued for all enabled sources.');
      await fetchHealth();
    } catch (err) {
      console.error(`Failed to trigger scraping`, err);
      toast.error('Failed to trigger scraping queue.');
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (state: string) => {
    switch (state) {
      case 'CLOSED':
        return <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>;
      case 'OPEN':
        return <Badge className="bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5 font-medium"><AlertTriangle className="h-3 w-3" /> Tripped</Badge>;
      case 'HALF-OPEN':
        return <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5 font-medium"><Clock className="h-3 w-3" /> Testing</Badge>;
      default:
        return <Badge className="bg-slate-500/10 text-slate-400 border border-slate-500/20 px-2 py-0.5 rounded-full flex items-center gap-1.5 font-medium"><HelpCircle className="h-3 w-3" /> Unknown</Badge>;
    }
  };

  const getCooldownRemaining = (openedAt?: number) => {
    if (!openedAt) return null;
    const COOLDOWN_MS = 2 * 60 * 60 * 1000;
    const elapsed = Date.now() - openedAt;
    const remaining = COOLDOWN_MS - elapsed;
    if (remaining <= 0) return 'Testing in progress...';
    const minutes = Math.ceil(remaining / 60000);
    return `${minutes} min cooldown remaining`;
  };

  // Filter logs based on filter level and search query
  const filteredLogs = logs.filter((log) => {
    if (levelFilter !== 'ALL' && log.level.toUpperCase() !== levelFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const msg = log.message.toLowerCase();
      const meta = JSON.stringify(log.meta).toLowerCase();
      return msg.includes(q) || meta.includes(q);
    }
    return true;
  });

  const isScrapingActive = scrapingStatus.status === 'running';
  const isScoringActive = scoringStatus.status === 'running';

  return (
    <div className="min-h-screen bg-background p-6 text-foreground font-sans">
      <div className="mx-auto max-w-6xl space-y-8">

        {/* Global Active Worker Banner */}
        {(isScrapingActive || isScoringActive) && (
          <div
            className="rounded-xl border border-primary/20 bg-primary/10 p-4 flex items-center justify-between shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-300"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <Cpu className="h-6 w-6 text-primary animate-pulse" />
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
              <div>
                <h4 className="font-semibold text-foreground text-sm">
                  {isScrapingActive && isScoringActive
                    ? 'Background Scraping & AI Scoring Active...'
                    : isScrapingActive
                      ? `Scraper Active — Running ${scrapingStatus.targetScraperName || 'all sources'}...`
                      : `AI Engine Active — Scoring jobs batch...`}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isScrapingActive && `Fetching and importing new listings in the background.`}
                  {isScoringActive && `Running personal calibration model on fetched jobs.`}
                </p>
              </div>
            </div>
            <Badge className="bg-primary/20 text-primary border border-primary/30">Active</Badge>
          </div>
        )}

        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
              Scraper Control Center
            </h1>
            <p className="text-muted-foreground mt-1.5 text-sm">
              Monitor circuit breakers, check failure frequencies, and queue custom scrapers.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setRefreshing(true);
                fetchHealth();
              }}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh Status
            </Button>

            <Button
              size="lg"
              disabled={actionLoading === 'trigger-all'}
              onClick={() => handleTrigger()}
            >
              <Play className="h-4 w-4" />
              {actionLoading === 'trigger-all' ? 'Queuing...' : 'Scrape All Sources'}
            </Button>
          </div>
        </div>

        {/* Info Banner */}
        <div className="rounded-xl border border-primary/10 bg-linear-to-r from-primary/5 to-card/25 p-4 flex items-start gap-3">
          <Shield className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <h3 className="font-semibold text-foreground">Circuit Breaker Policy Active</h3>
            <p className="text-muted-foreground mt-1 leading-relaxed">
              If a scraper experiences <strong>3 consecutive failures</strong>, its circuit breaker will trip (<span className="text-destructive font-medium">Tripped</span> status).
              A tripped scraper is automatically skipped during scheduled runs. The circuit self-heals by transitioning to <strong>Testing</strong> after a 2-hour cooldown.
            </p>
          </div>
        </div>

        {/* Scrapers Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-44 rounded-xl border border-border bg-muted/20 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(scrapers).map(([name, health]) => (
              <div
                key={name}
                className="animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <Card className="border border-border bg-card/40 backdrop-blur-md hover:border-border/80 hover:bg-card/60 transition-all duration-300 shadow-lg">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <CardTitle className="text-lg font-bold capitalize text-foreground">{name}</CardTitle>
                        <CardDescription className="text-xs text-muted-foreground">
                          {name === 'ats' ? 'Programmatic ATS Scanner' : `${name} Job Portal Scraper`}
                        </CardDescription>
                      </div>
                      {getStatusBadge(health.state)}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* Metrics */}
                    <div className="grid grid-cols-2 gap-2 text-xs py-2 border-y border-border/40">
                      <div>
                        <span className="text-muted-foreground">Consec. Failures:</span>
                        <p className={`font-semibold mt-0.5 ${health.failures > 0 ? 'text-destructive' : 'text-foreground'}`}>
                          {health.failures} / 3
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Auto-Recovery:</span>
                        <p className="font-semibold text-foreground mt-0.5">
                          {health.state === 'OPEN' ? 'Timer Active' : 'Idle'}
                        </p>
                      </div>
                    </div>

                    {/* Cooldown Text */}
                    {health.state === 'OPEN' && health.openedAt && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {getCooldownRemaining(health.openedAt)}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        disabled={health.state !== 'OPEN' || actionLoading === `reset-${name}`}
                        onClick={() => handleReset(name)}
                      >
                        <RotateCcw />
                        Reset Circuit
                      </Button>

                      <Button
                        disabled={actionLoading === `trigger-${name}`}
                        onClick={() => handleTrigger(name)}
                      >
                        <Play />
                        Run Scraper
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        )}

        {/* Real-time Logs Terminal */}
        <Card>
          <CardHeader className="border-b flex flex-row items-center justify-between ">
            <div className="flex items-center gap-4">
              <Terminal className="h-4.5 w-4.5 text-primary" />
              <div>
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  Live Log Terminal
                  {logs.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {logs.length} logs
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">Real-time backend worker stdout logs stream</CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Filter Dropdown */}
              <Select
                value={levelFilter}
                onValueChange={(value: any) => setLevelFilter(value as any)}
                className="border text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter logs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Levels</SelectItem>
                  <SelectItem value="INFO">Info</SelectItem>
                  <SelectItem value="WARN">Warn</SelectItem>
                  <SelectItem value="ERROR">Error</SelectItem>
                  <SelectItem value="DEBUG">Debug</SelectItem>
                </SelectContent>
              </Select>

              {/* Search input */}
              <Input
                type="text"
                placeholder="Filter logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              {/* Controls */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsPaused(!isPaused)}
                title={isPaused ? "Resume log stream" : "Pause log stream"}
              >
                {isPaused ? <Play className="h-3.5 w-3.5 text-emerald-400" /> : <Pause className="h-3.5 w-3.5" />}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLogs([])}
                title="Clear logs"
              >
                <Trash2 />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTerminalCollapsed(!terminalCollapsed)}
              >
                {terminalCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>

          {!terminalCollapsed && (
            <>
              <CardContent className="p-0">
                <ScrollArea className="h-72">
                  <div className="w-full  font-mono text-xs rounded-b-xl border-t p-4 space-y-1.5 min-h-full">
                    {filteredLogs.length === 0 ? (
                      <div className="italic text-center py-12">
                        {searchQuery ? "No logs matching search query." : isPaused ? "Logs paused. Click play to resume." : "No logs received yet. Run a scraper to see outputs here."}
                      </div>
                    ) : (
                      filteredLogs.map((log, idx) => {
                        let levelColor = 'text-emerald-400';
                        if (log.level === 'error') levelColor = 'text-rose-500 font-bold';
                        else if (log.level === 'warn') levelColor = 'text-amber-500 font-semibold';
                        else if (log.level === 'debug') levelColor = 'text-slate-500';

                        return (
                          <div key={idx} className="flex items-start gap-2 hover:bg-background/20 py-0.5 rounded px-1 transition-all">
                            <span className="shrink-0 select-none">[{log.timestamp.split(' ')[1] || log.timestamp}]</span>
                            <span className={`${levelColor} shrink-0 select-none uppercase w-12`}>[{log.level}]</span>
                            <span className="break-all select-text">{log.message}</span>
                            {Object.keys(log.meta || {}).length > 0 && (
                              <span className="text-[10px] break-all select-text">
                                {JSON.stringify(log.meta)}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                </ScrollArea>
              </CardContent>

              {/* Autoscroll checkbox */}
              <CardFooter>
                <div className="px-4 py-2 flex items-center justify-between text-xs">
                  <Field orientation="horizontal">
                    <Checkbox
                      id="auto-scroll"
                      checked={autoScroll}
                      onCheckedChange={(checked: boolean) => setAutoScroll(checked)}
                      className="rounded text-primary focus:ring-primary cursor-pointer"
                    />
                    <Label htmlFor="auto-scroll" className="cursor-pointer">Auto-scroll to latest</Label>
                  </Field>
                </div>
              </CardFooter>
            </>

          )}
        </Card>
      </div>
    </div>
  );
}
