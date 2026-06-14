'use client';

import { useEffect, useState, useCallback } from 'react';
import { jobsApi, Job } from '@/lib/api';
import JobCard from '@/components/JobCard';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useSocket } from '@/lib/socket';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';

const STATUS_TABS = [
  { value: 'SCORED', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'APPLIED', label: 'Applied' },
  { value: 'ALL', label: 'All Jobs' },
] as const;

type StatusTabValue = typeof STATUS_TABS[number]['value'];

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<StatusTabValue>('SCORED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 24 };
      if (activeTab !== 'ALL') {
        params.status = activeTab;
      }
      if (search) {
        params.search = search;
      }

      const data = await jobsApi.list(params);
      setJobs(data.jobs);
      setTotal(data.pagination.total);
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, page]);

  useEffect(() => {
    setPage(1);
    loadJobs();
  }, [activeTab, search, loadJobs]);

  useEffect(() => {
    loadJobs();
  }, [page, loadJobs]);

  // Real-time: refresh when new jobs are scored
  useSocket('job:scored', () => {
    if (activeTab === 'SCORED' || activeTab === 'ALL') {
      loadJobs();
    }
  });

  const handleApprove = async (id: string) => {
    await jobsApi.updateStatus(id, 'APPROVED');
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const handleSkip = async (id: string) => {
    await jobsApi.updateStatus(id, 'SKIPPED');
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const handleBlacklist = async (id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    if (!confirm(`Blacklist ${job.company}? All their jobs will be hidden.`)) return;
    await jobsApi.updateStatus(id, 'BLACKLISTED');
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const totalPages = Math.ceil(total / 24);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">Job Queue</h1>
          <p className="text-muted-foreground text-sm mt-1">{total} jobs matching criteria · Sorted by fit score</p>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch justify-between">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search roles, tech, or companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Shadcn Tabs for Status */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as StatusTabValue)}
          className="w-full sm:w-auto"
        >
          <TabsList className="grid w-full grid-cols-4">
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Job Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border rounded-2xl">
          <SlidersHorizontal className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="font-bold text-lg">No jobs found</p>
          <p className="text-muted-foreground text-sm mt-1 max-w-sm">
            {activeTab === 'SCORED'
              ? 'No new roles pending review. Run a manual scraping task from settings or dashboard!'
              : 'Try widening your search terms or checking different filter tabs.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onApprove={handleApprove}
                onSkip={handleSkip}
                onBlacklist={handleBlacklist}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="text-sm text-muted-foreground px-3">
                    Page {page} of {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => p + 1)}
                    className={page >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}
    </div>
  );
}
