'use client';

import { Job } from '@/lib/api';
import { Building2, MapPin, DollarSign, ExternalLink, Clock } from 'lucide-react';
import Link from 'next/link';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface JobCardProps {
  job: Job;
  onApprove?: (id: string) => void;
  onSkip?: (id: string) => void;
  onBlacklist?: (id: string) => void;
}

export default function JobCard({ job, onApprove, onSkip, onBlacklist, ...props }: React.ComponentProps<'div'> & JobCardProps) {
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
    <Card {...props}>
      <CardHeader>
        {/* Header */}
        <CardTitle >
          <Link href={`/jobs/${job.id}`}>
            {job.title}
          </Link>
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5 mt-1">
          <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground font-medium">{job.company}</span>
        </CardDescription>

        {/* Score Badge */}
        {score !== undefined && (
          <CardAction>
            <Badge>
              {score}%
            </Badge>
          </CardAction>
        )}

      </CardHeader>
      <CardContent >
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
      </CardContent>

      {/* Footer */}
      <CardFooter>
        <span className="flex flex-1 gap-2 items-center text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          {timeAgo(job.scrapedAt)}
        </span>

        {(() => {
          let applyUrl = job.url;
          try {
            const urlObj = new URL(job.applyUrl || job.url);
            urlObj.searchParams.set('__jh', job.id);
            applyUrl = urlObj.toString();
          } catch {}
          return (
            <Button
              variant="link"
              size="icon"
              asChild
            >
              <Link href={applyUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
              </Link>
            </Button>
          );
        })()}

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
      </CardFooter>
    </Card>
  );
}
