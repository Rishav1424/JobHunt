'use client';

import * as React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="flex flex-col items-center justify-center min-h-screen p-6 font-sans bg-[oklch(0.145_0_0)] text-[oklch(0.985_0_0)]">
        <div className="max-w-md w-full text-center space-y-4">
          <h2 className="text-2xl font-bold text-[oklch(0.704_0.191_22.216)]">Application Error</h2>
          <p className="text-sm opacity-70">{error.message || 'An unexpected error occurred.'}</p>
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors bg-[oklch(0.922_0_0)] text-[oklch(0.205_0_0)] hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
