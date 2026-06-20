'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { jobsApi, Job } from '@/lib/api';
import JobCard from '@/components/JobCard';
import { useSocket } from '@/lib/socket';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';
import {
  Search,
  SlidersHorizontal,
  LayoutGrid,
  List,
  RefreshCw,
  Check,
  X,
  ShieldAlert,
  Sliders,
  DollarSign,
  ExternalLink,
  ChevronDown,
  Play
} from 'lucide-react';
import Link from 'next/link';

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

  // View state: 'grid' | 'table'
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Filter Panel states
  const [showFilters, setShowFilters] = useState(false);
  const [minScore, setMinScore] = useState<number>(0);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [minSalary, setMinSalary] = useState<string>('');

  // Bulk Selection states
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActionRunning, setBulkActionRunning] = useState(false);

  // Rescoring loader state
  const [rescoringId, setRescoringId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page,
        limit: 24,
        ...(activeTab !== 'ALL' ? { status: activeTab } : {}),
        ...(search ? { search } : {}),
        ...(minScore > 0 ? { minScore } : {}),
        ...(selectedSource !== 'all' ? { source: selectedSource } : {}),
      };

      const data = await jobsApi.list(params);

      // Client-side salary filtering if needed, or backend filtering
      let fetchedJobs = data.jobs as Job[];
      if (minSalary) {
        const minVal = parseFloat(minSalary);
        if (!isNaN(minVal)) {
          fetchedJobs = fetchedJobs.filter(j => {
            const maxSalary = j.salaryMax || 0;
            const minSalaryVal = j.salaryMin || 0;
            return maxSalary >= minVal || minSalaryVal >= minVal;
          });
        }
      }

      setJobs(fetchedJobs);
      setTotal(data.pagination.total);
    } catch (err) {
      console.error('Failed to load jobs', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, page, minScore, selectedSource, minSalary]);

  useEffect(() => {
    setPage(1);
    loadJobs();
  }, [activeTab, search, minScore, selectedSource, minSalary, loadJobs]);

  useEffect(() => {
    loadJobs();
  }, [page, loadJobs]);

  // Real-time listener: refresh when new jobs are scored
  useSocket('job:scored', () => {
    if (activeTab === 'SCORED' || activeTab === 'ALL') {
      loadJobs();
    }
  });

  const handleApprove = async (id: string) => {
    await jobsApi.updateStatus(id, 'APPROVED');
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
  };

  const handleSkip = async (id: string) => {
    await jobsApi.updateStatus(id, 'SKIPPED');
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
  };

  const handleBlacklist = async (id: string) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return;
    if (!confirm(`Blacklist ${job.company}? All their jobs will be hidden.`)) return;
    await jobsApi.updateStatus(id, 'BLACKLISTED');
    setJobs((prev) => prev.filter((j) => j.id !== id));
    setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
  };

  const handleRescore = async (id: string) => {
    setRescoringId(id);
    try {
      await jobsApi.triggerScore(id);
      toast.success('Rescoring has been enqueued in the background queue.');
    } catch (err) {
      console.error('Rescore failed', err);
      toast.error('Failed to trigger rescoring. Please try again.');
    } finally {
      setRescoringId(null);
    }
  };

  // Bulk Actions
  const handleBulkApprove = async () => {
    if (selectedIds.length === 0) return;
    setBulkActionRunning(true);
    try {
      await jobsApi.bulkUpdateStatus(selectedIds, 'APPROVED');
      setJobs((prev) => prev.filter((j) => !selectedIds.includes(j.id)));
      setSelectedIds([]);
    } catch (err) {
      console.error('Bulk approval failed', err);
    } finally {
      setBulkActionRunning(false);
    }
  };

  const handleBulkSkip = async () => {
    if (selectedIds.length === 0) return;
    setBulkActionRunning(true);
    try {
      await jobsApi.bulkUpdateStatus(selectedIds, 'SKIPPED');
      setJobs((prev) => prev.filter((j) => !selectedIds.includes(j.id)));
      setSelectedIds([]);
    } catch (err) {
      console.error('Bulk skip failed', err);
    } finally {
      setBulkActionRunning(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === jobs.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(jobs.map((j) => j.id));
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds((prev) => prev.filter((x) => x !== id));
    } else {
      setSelectedIds((prev) => [...prev, id]);
    }
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    return 'Just now';
  };

  const totalPages = Math.ceil(total / 24);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto bg-background min-h-screen text-foreground font-sans">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-linear-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
            Job Queue
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">{total} jobs matching criteria · Sorted by fit score</p>
        </div>
      </div>

      {/* Filters & Mode Toolbar */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch justify-between">

          {/* Left search & filters */}
          <div className="flex items-center gap-2 flex-1 max-w-lg">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search roles, tech, or companies..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-card border-border text-foreground text-xs rounded-lg h-9 placeholder:text-muted-foreground/50"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={`border-border h-9 rounded-lg px-3 flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ${showFilters ? 'bg-muted text-foreground border-border' : 'bg-muted/30'
                }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
            </Button>
          </div>

          {/* Right Mode Toggles & Tabs */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex rounded-lg border border-border bg-muted/30 p-0.5 shrink-0 self-stretch sm:self-auto justify-center">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Card Grid"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                title="Spreadsheet Table"
              >
                <List className="h-4 w-4" />
              </button>
            </div>

            {/* Status Tabs */}
            <Tabs
              value={activeTab}
              onValueChange={(val: StatusTabValue) => {
                setActiveTab(val);
                setSelectedIds([]);
              }}
              className="w-full sm:w-auto"
            >
              <TabsList className="bg-muted border border-border p-0.5 grid grid-cols-4 rounded-xl">
                {STATUS_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="rounded-lg text-xs py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground cursor-pointer"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

        </div>

        {/* Expandable Advanced Filters Drawer */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
            showFilters ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            <div className="p-4 border border-border bg-muted/30 rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-4">

                {/* Min Fit Score */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Min Fit Score</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={minScore}
                      onChange={(e) => setMinScore(parseInt(e.target.value, 10))}
                      className="w-full accent-primary bg-background h-1.5 rounded-lg"
                    />
                    <Badge className="bg-primary/10 text-primary border-primary/20 w-10 text-center shrink-0">{minScore}%</Badge>
                  </div>
                </div>

                {/* Scraper Source */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Scraper Source</label>
                  <select
                    value={selectedSource}
                    onChange={(e) => setSelectedSource(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg text-xs p-1.5 text-foreground"
                  >
                    <option value="all">All Sources</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="naukri">Naukri</option>
                    <option value="wellfound">Wellfound</option>
                    <option value="instahyre">Instahyre</option>
                    <option value="adzuna">Adzuna</option>
                    <option value="remoteok">RemoteOK</option>
                    <option value="ycombinator">YCombinator</option>
                  </select>
                </div>

                {/* Min Salary */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Min Salary (LPA)</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-muted-foreground text-xs">₹</span>
                    <Input
                      type="number"
                      placeholder="e.g. 15"
                      value={minSalary}
                      onChange={(e) => setMinSalary(e.target.value)}
                      className="pl-6 bg-background border-border text-foreground text-xs h-8 rounded-lg"
                    />
                  </div>
                </div>

              </div>
          </div>
        </div>
      </div>

      {/* Bulk Action Floating Panel */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border border-border px-6 py-3 rounded-full flex items-center gap-4 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-in-out ${
          selectedIds.length > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20 pointer-events-none'
        }`}
      >
        <span className="text-xs font-bold text-primary">{selectedIds.length} roles selected</span>

        <div className="h-4 w-px bg-border" />

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkSkip}
            disabled={bulkActionRunning}
            className="h-8 border-border text-destructive hover:bg-destructive/10 rounded-full text-xs cursor-pointer"
          >
            <X className="h-3 w-3 mr-1" />
            Bulk Skip
          </Button>
          <Button
            size="sm"
            onClick={handleBulkApprove}
            disabled={bulkActionRunning}
            className="h-8 rounded-full text-xs cursor-pointer"
          >
            <Check className="h-3 w-3 mr-1" />
            Bulk Approve
          </Button>
        </div>
      </div>

      {/* Job Grid / Dense Spreadsheet Table */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-2xl">
          <Sliders className="w-12 h-12 text-muted-foreground mb-4" />
          <p className="font-bold text-lg">No jobs found</p>
          <p className="text-muted-foreground text-xs mt-1.5 max-w-sm leading-relaxed">
            {activeTab === 'SCORED'
              ? 'No new roles pending review. Run a manual scraping task from settings or dashboard!'
              : 'Try widening your search terms or checking different filter tabs.'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        /* STANDARD CARD VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {jobs.map((job) => (
            <div key={job.id} className="relative group">
              {/* Checkbox Overlay */}
              {activeTab === 'SCORED' && (
                <div className="absolute top-3 left-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Checkbox
                    checked={selectedIds.includes(job.id)}
                    onCheckedChange={() => toggleSelect(job.id)}
                    className="border-border bg-card/85 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground h-4 w-4"
                  />
                </div>
              )}
              <JobCard
                job={job}
                onApprove={handleApprove}
                onSkip={handleSkip}
                onBlacklist={handleBlacklist}
              />
            </div>
          ))}
        </div>
      ) : (
        /* DENSE SPREADSHEET TABLE VIEW */
        <div className="rounded-xl border border-border bg-card/20 backdrop-blur-md overflow-hidden">
          <Table>
            <TableHeader className="bg-muted text-muted-foreground">
              <TableRow className="border-b border-border">
                {activeTab === 'SCORED' && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.length === jobs.length}
                      onCheckedChange={toggleSelectAll}
                      className="border-border bg-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground h-4 w-4"
                    />
                  </TableHead>
                )}
                <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Job Title</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Company</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Score</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Location</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Salary</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Source</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Age</TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wider text-muted-foreground text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id} className="border-b border-border/60 hover:bg-muted/40 text-xs">
                  {activeTab === 'SCORED' && (
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.includes(job.id)}
                        onCheckedChange={() => toggleSelect(job.id)}
                        className="border-border bg-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground h-4 w-4"
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-bold text-foreground">
                    <Link href={`/jobs/${job.id}`} className="hover:underline">
                      {job.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{job.company}</TableCell>
                  <TableCell>
                    {job.fitScore !== undefined && (
                      <Badge className={`text-[10px] font-bold py-0.5 rounded-full ${job.fitScore >= 80
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : job.fitScore >= 60
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                        {job.fitScore}%
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{job.isRemote ? 'Remote' : job.location}</TableCell>
                  <TableCell className="text-muted-foreground truncate max-w-[120px]">{job.salaryRaw || 'Unknown'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] border-border text-muted-foreground uppercase">{job.source}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{timeAgo(job.scrapedAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>

                      {/* Manual Rescore */}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Rescore Job"
                        disabled={rescoringId === job.id}
                        onClick={() => handleRescore(job.id)}
                        className="h-7 w-7 text-muted-foreground hover:text-primary cursor-pointer"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${rescoringId === job.id ? 'animate-spin' : ''}`} />
                      </Button>

                      {job.status === 'SCORED' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSkip(job.id)}
                            className="h-7 hover:bg-destructive/10 hover:text-destructive text-xs px-2 text-muted-foreground cursor-pointer"
                          >
                            Skip
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleApprove(job.id)}
                            className="h-7 text-xs px-2 cursor-pointer"
                          >
                            Approve
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <Pagination className="pt-4">
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

    </div>
  );
}
