'use client';

import { useEffect, useState, useCallback } from 'react';
import { jobsApi, Job } from '@/lib/api';
import JobCard from '@/components/JobCard';
import { Search, Filter, SlidersHorizontal } from 'lucide-react';
import { clsx } from 'clsx';
import { useSocket } from '@/lib/socket';

const STATUS_TABS = [
  { value: 'SCORED', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'APPLIED', label: 'Applied' },
  { value: '', label: 'All' },
];

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('SCORED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 24 };
      if (activeTab) params.status = activeTab;
      if (search) params.search = search;

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
  }, [activeTab, search]);

  useEffect(() => { loadJobs(); }, [page]);

  // Real-time: refresh when new jobs are scored
  useSocket('job:scored', () => {
    if (activeTab === 'SCORED' || activeTab === '') loadJobs();
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

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Job Queue</h1>
          <p className="text-gray-400 text-sm mt-0.5">{total} jobs · Sorted by fit score</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search jobs or companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Status Tabs */}
        <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={clsx(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                activeTab === tab.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Job Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass rounded-xl p-4 h-44 animate-pulse">
              <div className="h-4 bg-gray-800 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-800 rounded w-1/2 mb-4" />
              <div className="h-3 bg-gray-800 rounded w-full mb-2" />
              <div className="h-3 bg-gray-800 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <SlidersHorizontal className="w-12 h-12 text-gray-700 mb-4" />
          <p className="text-gray-400 font-medium">No jobs found</p>
          <p className="text-gray-600 text-sm mt-1">
            {activeTab === 'SCORED'
              ? 'No jobs pending review. Run a scrape to find new jobs!'
              : 'Try changing the filter or search term.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
          {total > 24 && (
            <div className="flex justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs rounded-md bg-gray-800 text-gray-300 disabled:opacity-40 hover:bg-gray-700 transition-colors"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-xs text-gray-400">
                Page {page} of {Math.ceil(total / 24)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(total / 24)}
                className="px-3 py-1.5 text-xs rounded-md bg-gray-800 text-gray-300 disabled:opacity-40 hover:bg-gray-700 transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
