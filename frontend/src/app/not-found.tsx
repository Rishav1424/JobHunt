import * as React from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <h2 className="text-3xl font-extrabold text-destructive">404 — Page Not Found</h2>
        <p className="text-muted-foreground text-sm">The page you are looking for does not exist or has been moved.</p>
        <Button asChild>
          <Link href='/dashboard'>
            Go to Dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
