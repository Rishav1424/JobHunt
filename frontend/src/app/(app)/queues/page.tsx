'use client';

import React, { useState, useEffect } from 'react';
import { jobsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Cpu,
  Trash2,
  RefreshCw,
  Clock,
  Play,
  CheckCircle,
  AlertOctagon,
  Pause,
  Layers
} from 'lucide-react';

interface QueueStatus {
  name: string;
  displayName: string;
  counts: {
    wait: number;
    active: number;
    failed: number;
    completed: number;
    delayed: number;
    paused: number;
  };
}

export default function QueuesPage() {
  const [queues, setQueues] = useState<QueueStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchQueues = async () => {
    try {
      const response = await jobsApi.getQueueStatus();
      if (response && response.queues) {
        setQueues(response.queues);
      }
    } catch (err) {
      console.error('Failed to fetch queue status', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleDrain = async (name: string) => {
    if (!confirm(`Are you sure you want to drain the "${name}" queue? This deletes all waiting/failed/completed jobs.`)) {
      return;
    }
    setActionLoading(`drain-${name}`);
    try {
      await jobsApi.drainQueue(name);
      await fetchQueues();
    } catch (err) {
      console.error(`Failed to drain queue ${name}`, err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 text-foreground font-sans">
      <div className="mx-auto max-w-6xl space-y-8">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
              BullMQ Queue Monitor
            </h1>
            <p className="text-muted-foreground mt-1.5 text-sm">
              Real-time monitoring of job scraping, Gemini scoring, and resume compilation processes.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRefreshing(true);
              fetchQueues();
            }}
            disabled={refreshing}
            className="border-border bg-card/45 text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-lg flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Queues
          </Button>
        </div>

        {/* Queues Overview */}
        {loading ? (
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 rounded-xl border border-border bg-muted/20 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {queues.map((q) => {
              const totalActiveAndWaiting = q.counts.active + q.counts.wait;
              const hasJobs = q.counts.active > 0 || q.counts.wait > 0 || q.counts.failed > 0;

              return (
                <div
                  key={q.name}
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  <Card className="border border-border bg-card/40 backdrop-blur-md hover:border-border/80 hover:bg-card/60 transition-all duration-300 shadow-xl">
                    <CardHeader className="pb-3 border-b border-border/60 flex flex-row items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Cpu className="h-5 w-5 text-primary" />
                          <CardTitle className="text-lg font-bold text-foreground">{q.displayName}</CardTitle>
                        </div>
                        <CardDescription className="text-xs text-muted-foreground">
                          System name: <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[10px]">{q.name}</code>
                        </CardDescription>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionLoading === `drain-${q.name}` || !hasJobs}
                        onClick={() => handleDrain(q.name)}
                        className="border-destructive/20 hover:border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20 text-xs rounded-lg cursor-pointer"
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Drain Queue
                      </Button>
                    </CardHeader>

                    <CardContent className="pt-6 space-y-6">
                      {/* Metric Widgets */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">

                        {/* Wait */}
                        <div className="rounded-lg bg-muted/40 border border-border p-3 text-center">
                          <div className="flex justify-center text-primary mb-1">
                            <Clock className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Waiting</span>
                          <p className="text-2xl font-bold mt-1 text-primary">{q.counts.wait}</p>
                        </div>

                        {/* Active */}
                        <div className="rounded-lg bg-muted/40 border border-border p-3 text-center relative overflow-hidden">
                          {q.counts.active > 0 && (
                            <span className="absolute top-0 right-0 flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                          )}
                          <div className="flex justify-center text-emerald-400 mb-1">
                            <Play className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Active</span>
                          <p className="text-2xl font-bold mt-1 text-emerald-400">{q.counts.active}</p>
                        </div>

                        {/* Failed */}
                        <div className="rounded-lg bg-muted/40 border border-border p-3 text-center">
                          <div className="flex justify-center text-destructive mb-1">
                            <AlertOctagon className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Failed</span>
                          <p className={`text-2xl font-bold mt-1 ${q.counts.failed > 0 ? 'text-destructive' : 'text-foreground'}`}>{q.counts.failed}</p>
                        </div>

                        {/* Completed */}
                        <div className="rounded-lg bg-muted/40 border border-border p-3 text-center">
                          <div className="flex justify-center text-muted-foreground mb-1">
                            <CheckCircle className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Completed</span>
                          <p className="text-2xl font-bold mt-1 text-foreground">{q.counts.completed}</p>
                        </div>

                        {/* Delayed */}
                        <div className="rounded-lg bg-muted/40 border border-border p-3 text-center">
                          <div className="flex justify-center text-amber-500 mb-1">
                            <Clock className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Delayed</span>
                          <p className="text-2xl font-bold mt-1 text-foreground">{q.counts.delayed}</p>
                        </div>

                        {/* Paused */}
                        <div className="rounded-lg bg-muted/40 border border-border p-3 text-center">
                          <div className="flex justify-center text-muted-foreground mb-1">
                            <Pause className="h-4 w-4" />
                          </div>
                          <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Paused</span>
                          <p className="text-2xl font-bold mt-1 text-foreground">{q.counts.paused}</p>
                        </div>

                      </div>

                      {/* Progress representation */}
                      {totalActiveAndWaiting > 0 && (
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Processing Queue Load</span>
                            <span>{q.counts.active} processing, {q.counts.wait} waiting</span>
                          </div>
                          <Progress value={Math.min(100, (q.counts.active / totalActiveAndWaiting) * 100)} className="h-1.5" />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
