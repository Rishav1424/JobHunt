'use client';

import { Job } from '@/lib/api';
import { Building2, MapPin, DollarSign, ExternalLink, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import Link from 'next/link';

interface JobCardProps {
  job: Job;
  onApprove?: (id: string) => void;
  onSkip?: (id: string) => void;
  onBlacklist?: (id: string) => void;
}

export default function JobCard({ job, onApprove, onSkip, onBlacklist }: JobCardProps) {
  const score = job.fitScore;
  const scoreClass = score !== undefined
    ? score >= 75 ? 'high' : score >= 55 ? 'mid' : 'low'
    : 'low';

  const sourceBadgeColor: Record<string, string> = {
    wellfound: 'bg-orange-500/15 text-orange-400',
    instahyre: 'bg-purple-500/15 text-purple-400',
    linkedin: 'bg-blue-500/15 text-blue-400',
    adzuna: 'bg-green-500/15 text-green-400',
    remoteok: 'bg-cyan-500/15 text-cyan-400',
  };

  const statusBadge: Record<string, { color: string; label: string }> = {
    SCORED: { color: 'bg-yellow-500/15 text-yellow-400', label: 'Pending Review' },
    APPROVED: { color: 'bg-blue-500/15 text-blue-400', label: 'Approved' },
    APPLIED: { color: 'bg-green-500/15 text-green-400', label: 'Applied' },
    SKIPPED: { color: 'bg-gray-500/15 text-gray-400', label: 'Skipped' },
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    return 'Just now';
  };

  return (
    <div className="glass rounded-xl p-4 hover:border-blue-600/30 hover:glow-primary transition-all duration-200 group">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <Link href={`/jobs/${job.id}`}>
            <h3 className="font-semibold text-white text-sm leading-tight hover:text-blue-400 transition-colors cursor-pointer">
              {job.title}
            </h3>
          </Link>
          <div className="flex items-center gap-1.5 mt-1">
            <Building2 className="w-3 h-3 text-gray-500 shrink-0" />
            <span className="text-xs text-gray-400 font-medium">{job.company}</span>
          </div>
        </div>

        {/* Score Badge */}
        {score !== undefined && (
          <div className={`badge-score ${scoreClass} shrink-0`}>
            {score}%
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-2 mb-3">
        {/* Location */}
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <MapPin className="w-3 h-3" />
          {job.isRemote ? 'Remote' : job.location}
        </span>

        {/* Salary */}
        {job.salaryRaw && (
          <span className="flex items-center gap-1 text-xs text-emerald-400">
            <DollarSign className="w-3 h-3" />
            {job.salaryRaw}
          </span>
        )}

        {/* Source */}
        <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
          sourceBadgeColor[job.source] || 'bg-gray-500/15 text-gray-400')}>
          {job.source}
        </span>

        {/* Status */}
        {statusBadge[job.status] && (
          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
            statusBadge[job.status].color)}>
            {statusBadge[job.status].label}
          </span>
        )}
      </div>

      {/* Fit Analysis Snippet */}
      {job.fitAnalysis && (
        <p className="text-xs text-gray-500 line-clamp-1 mb-3 italic">
          {job.fitAnalysis.recommendation}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-gray-600">
          <Clock className="w-3 h-3" />
          {timeAgo(job.scrapedAt)}
        </span>

        <div className="flex items-center gap-2">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          {job.status === 'SCORED' && (
            <>
              <button
                onClick={() => onSkip?.(job.id)}
                className="px-2.5 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded-md transition-all"
              >
                Skip
              </button>
              <button
                onClick={() => onApprove?.(job.id)}
                className="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md font-medium transition-all"
              >
                Approve →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
