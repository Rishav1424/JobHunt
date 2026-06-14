'use client';

import { useEffect, useState, useCallback } from 'react';
import { applicationsApi, Application, ApplicationStatus } from '@/lib/api';
import { Building2, Calendar, ChevronRight, Mail, LayoutGrid } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

const STATUS_CONFIG: Record<ApplicationStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: 'Pending Review', variant: 'secondary' },
  APPLIED: { label: 'Applied', variant: 'default' },
  INTERVIEW: { label: 'Interview Scheduled! 🎉', variant: 'default' },
  OFFER: { label: 'Offer Received! 🏆', variant: 'default' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  WITHDRAWN: { label: 'Withdrawn', variant: 'outline' },
};

const STATUS_TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPLIED', label: 'Applied' },
  { value: 'INTERVIEW', label: 'Interview' },
  { value: 'OFFER', label: 'Offers' },
  { value: 'REJECTED', label: 'Rejected' },
] as const;

type StatusTabValue = typeof STATUS_TABS[number]['value'];

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<StatusTabValue>('ALL');

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const params = activeTab !== 'ALL' ? { status: activeTab } : undefined;
      const data = await applicationsApi.list(params);
      setApplications(data);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  const timeStr = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Applications</h1>
          <p className="text-muted-foreground text-sm mt-1">{applications.length} active applications tracked</p>
        </div>
      </div>

      {/* Status Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(val) => setActiveTab(val as StatusTabValue)}
        className="w-full"
      >
        <TabsList className="w-full flex flex-wrap">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="flex-1 min-w-[80px]">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Applications List */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border rounded-2xl">
          <LayoutGrid className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="font-bold text-lg">No applications found</p>
          <p className="text-muted-foreground text-sm mt-1 max-w-sm">
            Approve roles in the Job Queue and mark them as applied or interview to track them here.
          </p>
          <Button className="mt-4" render={<Link href="/jobs" />}>
            Go to Job Queue →
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => {
            const statusCfg = STATUS_CONFIG[app.status] || { label: app.status, variant: 'outline' as const };
            const fitScore = app.job.fitScore;
            const scoreVariant = fitScore !== undefined
              ? fitScore >= 75 ? 'default' : fitScore >= 55 ? 'secondary' : 'destructive'
              : 'secondary';

            return (
              <Card key={app.id} className="hover:bg-accent/50 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Score */}
                    {fitScore !== undefined && (
                      <Badge variant={scoreVariant} className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-xs font-extrabold">
                        {fitScore}%
                      </Badge>
                    )}

                    {/* Job info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/jobs/${app.jobId}`}>
                          <h3 className="text-sm font-bold truncate hover:underline cursor-pointer">
                            {app.job.title}
                          </h3>
                        </Link>
                        <Badge variant={statusCfg.variant}>
                          {statusCfg.label}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Building2 className="w-3.5 h-3.5" /> {app.job.company}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="w-3.5 h-3.5" /> Applied: {timeStr(app.appliedAt || app.createdAt)}
                        </span>
                        {app.emailEvents && app.emailEvents.length > 0 && (
                          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                            <Mail className="w-3.5 h-3.5" /> {app.emailEvents.length} email{app.emailEvents.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Latest email event */}
                    {app.emailEvents && app.emailEvents[0] && (
                      <div className="hidden md:block text-right shrink-0 max-w-[150px]">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Latest Email</p>
                        <p className="text-xs font-semibold truncate capitalize">
                          {app.emailEvents[0].type.toLowerCase().replace(/_/g, ' ')}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{timeStr(app.emailEvents[0].receivedAt)}</p>
                      </div>
                    )}

                    <Button variant="outline" size="icon" className="shrink-0" render={<Link href={`/jobs/${app.jobId}`} />}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
