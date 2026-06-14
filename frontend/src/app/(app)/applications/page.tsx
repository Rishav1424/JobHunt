'use client';

import { useEffect, useState, useCallback } from 'react';
import { applicationsApi, Application, ApplicationStatus } from '@/lib/api';
import { clsx } from 'clsx';
import { Building2, Calendar, Clock, ChevronRight, Mail } from 'lucide-react';
import Link from 'next/link';

const STATUS_CONFIG: Record<ApplicationStatus, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  APPLIED: { label: 'Applied', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  INTERVIEW: { label: 'Interview! 🎉', color: 'bg-green-500/15 text-green-400 border-green-500/30' },
  OFFER: { label: 'Offer! 🏆', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  REJECTED: { label: 'Rejected', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  WITHDRAWN: { label: 'Withdrawn', color: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
};

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'APPLIED', label: 'Applied' },
  { value: 'INTERVIEW', label: 'Interview' },
  { value: 'OFFER', label: 'Offer' },
  { value: 'REJECTED', label: 'Rejected' },
];

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('');

  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const params = activeTab ? { status: activeTab } : undefined;
      const data = await applicationsApi.list(params);
      setApplications(data);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { loadApps(); }, [loadApps]);

  const timeStr = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Applications</h1>
        <p className="text-gray-400 text-sm mt-0.5">{applications.length} applications tracked</p>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={clsx(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              activeTab === tab.value ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Applications List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass rounded-xl p-4 h-20 animate-pulse border border-gray-800" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-gray-400 font-medium">No applications yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Approve jobs from the Job Queue to start applying.
          </p>
          <Link href="/jobs" className="mt-3 px-4 py-2 text-xs bg-blue-600 text-white rounded-lg">
            Go to Job Queue →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => {
            const statusCfg = STATUS_CONFIG[app.status];
            return (
              <div key={app.id} className="glass rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-all">
                <div className="flex items-center gap-4">
                  {/* Score */}
                  {app.job.fitScore && (
                    <div className={clsx('badge-score shrink-0',
                      app.job.fitScore >= 75 ? 'high' : app.job.fitScore >= 55 ? 'mid' : 'low')}>
                      {app.job.fitScore}%
                    </div>
                  )}

                  {/* Job info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-white truncate">{app.job.title}</p>
                      <span className={clsx('px-2 py-0.5 text-xs rounded-full border', statusCfg.color)}>
                        {statusCfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Building2 className="w-3 h-3" /> {app.job.company}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Calendar className="w-3 h-3" /> Applied: {timeStr(app.appliedAt)}
                      </span>
                      {app.emailEvents?.length > 0 && (
                        <span className="flex items-center gap-1 text-xs text-blue-400">
                          <Mail className="w-3 h-3" /> {app.emailEvents.length} email{app.emailEvents.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Latest email event */}
                  {app.emailEvents?.[0] && (
                    <div className="hidden md:block text-right shrink-0">
                      <p className="text-xs text-gray-500">Latest</p>
                      <p className="text-xs text-gray-300 capitalize">
                        {app.emailEvents[0].type.toLowerCase().replace(/_/g, ' ')}
                      </p>
                      <p className="text-xs text-gray-600">{timeStr(app.emailEvents[0].receivedAt)}</p>
                    </div>
                  )}

                  <Link href={`/jobs/${app.jobId}`}>
                    <ChevronRight className="w-4 h-4 text-gray-600 hover:text-white transition-colors" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
