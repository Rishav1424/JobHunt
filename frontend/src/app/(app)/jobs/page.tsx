'use client';

import { useEffect, useState, useCallback } from 'react';
import { jobsApi, Job } from '@/lib/api';
import JobCard from '@/components/JobCard';
import { useSocket } from '@/lib/socket';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Sliders,
  IndianRupee,
  ExternalLink,

} from 'lucide-react';
import Link from 'next/link';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STATUS_TABS = [
  { value: 'ALL', label: 'All Jobs' },
  { value: 'SCORED', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'APPLIED', label: 'Applied' },
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
  const [minSalary, setMinSalary] = useState<number>(0); ``

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
        const minVal = minSalary;
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

  // 1. Reset page to 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [activeTab, search, minScore, selectedSource, minSalary]);

  // 2. Load jobs when loadJobs changes (which depends on filters and page)
  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

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
      <div>
        <div className="flex flex-col lg:flex-row gap-3 items-stretch justify-between">
          {/* Left search & filters */}
          <InputGroup className="max-w-96">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="text"
              placeholder="Search roles, tech, or companies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <InputGroupButton onClick={() => setShowFilters(!showFilters)}>
              <SlidersHorizontal />
              Filters
            </InputGroupButton>
          </InputGroup>

          {/* Right Mode Toggles & Tabs */}
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <Tabs
              value={viewMode}
              onValueChange={(val: "grid" | "table") => setViewMode(val)}
            >
              <TabsList variant="pills">
                <TabsTrigger value="grid">
                  <LayoutGrid className="h-4 w-4" />
                </TabsTrigger>
                <TabsTrigger value="table">
                  <List className="h-4 w-4" />
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Status Tabs */}
            <Tabs
              value={activeTab}
              onValueChange={(val: StatusTabValue) => {
                setActiveTab(val);
                setSelectedIds([]);
              }}
              className="w-full sm:w-auto"
            >
              <TabsList variant="line">
                {STATUS_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
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
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${showFilters ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'
            }`}
        >
          <div className="overflow-hidden">
            <div className="px-4 py-2 border border-border bg-muted/30 rounded-lg grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2">

              {/* Min Fit Score */}
              <Field>
                <FieldLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Min Fit Score  {minScore}%</FieldLabel>
                <Slider
                  min={0}
                  max={100}
                  value={[minScore]}
                  onValueChange={(value: [number]) => setMinScore(value[0])}
                  className="mt-2"
                />
              </Field>

              {/* Scraper Source */}
              <Field>
                <FieldLabel>Scraper Source</FieldLabel>
                <Select
                  value={selectedSource}
                  onValueChange={(val: string) => setSelectedSource(val)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="naukri">Naukri</SelectItem>
                    <SelectItem value="wellfound">Wellfound</SelectItem>
                    <SelectItem value="instahyre">Instahyre</SelectItem>
                    <SelectItem value="adzuna">Adzuna</SelectItem>
                    <SelectItem value="remoteok">RemoteOK</SelectItem>
                    <SelectItem value="ycombinator">YCombinator</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {/* Min Salary */}
              <Field>
                <FieldLabel>Min Salary (LPA)</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <IndianRupee />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="number"
                    placeholder="Expected salary in LPA"
                    value={minSalary}
                    onChange={(e) => setMinSalary(parseInt(e.target.value) || 0)}
                  />
                </InputGroup>
              </Field>

            </div>
          </div>
        </div>
      </div>

      {/* Bulk Action Floating Panel */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-background/50 border border-border px-4 py-2 rounded-xl flex items-center gap-4 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-in-out ${selectedIds.length > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-20 pointer-events-none'
          }`}
      >
        <Button
          variant="ghost"
          onClick={() => setSelectedIds([])}
        >
          <X />
        </Button>
        <span className="text-xs font-bold text-primary">{selectedIds.length} roles selected</span>

        <div className="h-4 w-px bg-border" />

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleBulkSkip}
            disabled={bulkActionRunning}
          >
            <X />
            Bulk Skip
          </Button>
          <Button
            onClick={handleBulkApprove}
            disabled={bulkActionRunning}
          >
            <Check />
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
            <JobCard
              key={job.id}
              job={job}
              onClick={() => toggleSelect(job.id)}
              onApprove={handleApprove}
              onSkip={handleSkip}
              onBlacklist={handleBlacklist}
              className={activeTab === 'SCORED' && selectedIds.includes(job.id) ? "ring-2 ring-primary" : ""}
            />
          ))}
        </div>
      ) : (
        /* DENSE SPREADSHEET TABLE VIEW */
        <div className="rounded-lg border border-border bg-card/20 backdrop-blur-md overflow-hidden">
          <Table>
            <TableHeader className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <TableRow className="border-b border-border">
                {activeTab === 'SCORED' && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.length === jobs.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                )}
                <TableHead className="py-2">
                  <div className="flex items-baseline">
                    <span className="font-medium text-base">Company </span>
                    <span className="text-[10px] font-light ml-2 text-muted-foreground"> | Location </span>
                  </div>
                  <span className="text-xs text-muted-foreground mt-2">Title</span>
                </TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Salary</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="text-right">Actions</TableHead>
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
                  <TableCell className="max-w-96 truncate">
                    <Link href={`/jobs/${job.id}`}>
                      <div className="flex items-baseline">
                        <span className="font-medium text-base">{job.company} </span>
                        <span className="text-[10px] ml-2 font-light text-muted-foreground"> | {job.isRemote ? 'Remote' : job.location} </span>
                      </div>
                      <span className="text-xs text-muted-foreground mt-2">{job.title}</span>
                    </Link>

                  </TableCell>
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
                  <TableCell className="text-muted-foreground truncate max-w-[120px]">{job.salaryRaw || 'Unknown'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] border-border text-muted-foreground uppercase">{job.source}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{timeAgo(job.scrapedAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <a
                        href={(() => {
                          try {
                            const u = new URL(job.applyUrl || job.url);
                            u.searchParams.set('__jh', job.id);
                            return u.toString();
                          } catch { return job.url; }
                        })()}
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
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (page > 1) setPage((p) => p - 1);
                }}
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
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (page < totalPages) setPage((p) => p + 1);
                }}
                className={page >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

    </div>
  );
}
