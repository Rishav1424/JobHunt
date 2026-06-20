'use client';

import { Job } from '@/lib/api';
import { Building2, MapPin, DollarSign, ExternalLink, Clock } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface JobCardProps {
  job: Job;
  onApprove?: (id: string) => void;
  onSkip?: (id: string) => void;
  onBlacklist?: (id: string) => void;
}

export default function JobCard({ job, onApprove, onSkip, onBlacklist }: JobCardProps) {
  const score = job.fitScore;
  const scoreVariant = score !== undefined
    ? score >= 75 ? 'default' : score >= 55 ? 'secondary' : 'destructive'
    : 'secondary';

  const statusBadge: Record<string, { variant: 'default' | 'secondary' | 'outline' | 'destructive'; label: string }> = {
    SCORED: { variant: 'secondary', label: 'Pending Review' },
    APPROVED: { variant: 'default', label: 'Approved' },
    APPLIED: { variant: 'default', label: 'Applied' },
    SKIPPED: { variant: 'outline', label: 'Skipped' },
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
    <Card className="hover:bg-accent/50 transition-colors">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link href={`/jobs/${job.id}`}>
              <h3 className="font-semibold text-sm leading-tight hover:underline cursor-pointer">
                {job.title}
              </h3>
            </Link>
            <div className="flex items-center gap-1.5 mt-1">
              <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground font-medium">{job.company}</span>
            </div>
          </div>

          {/* Score Badge */}
          {score !== undefined && (
            <Badge variant={scoreVariant} className="shrink-0">
              {score}%
            </Badge>
          )}
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="w-3 h-3" />
            {job.isRemote ? 'Remote' : job.location}
          </span>

          {job.salaryRaw && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              {job.salaryRaw}
            </span>
          )}

          <Badge variant="outline" className="text-xs">
            {job.source}
          </Badge>

          {statusBadge[job.status] && (
            <Badge variant={statusBadge[job.status].variant} className="text-xs">
              {statusBadge[job.status].label}
            </Badge>
          )}
        </div>

        {/* Fit Analysis Snippet */}
        {job.fitAnalysis && (
          <p className="text-xs text-muted-foreground line-clamp-1 italic">
            {job.fitAnalysis.recommendation}
          </p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {timeAgo(job.scrapedAt)}
          </span>

          <div className="flex items-center gap-2">
            <Button
              variant="link"
              size="icon"
              className="h-7 w-7"
              asChild
            >
              <Link href={job.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </Button>

            {job.status === 'SCORED' && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSkip?.(job.id)}
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  onClick={() => onApprove?.(job.id)}
                >
                  Approve →
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
