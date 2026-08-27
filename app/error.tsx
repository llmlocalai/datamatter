'use client';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="min-h-screen bg-navy-950 flex items-center justify-center px-6">
      <div className="max-w-lg">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-400 mb-3">Error</p>
        <h1 className="text-2xl font-bold text-navy-50">This page could not be rendered</h1>
        <p className="text-navy-300 mt-3 leading-relaxed text-sm">
          The data layer returned an error rather than an incomplete figure. Nothing partial is shown,
          because a number without its provenance is worse than no number.
        </p>
        {error.digest && (
          <p className="text-xs text-navy-500 font-mono mt-3">reference {error.digest}</p>
        )}
        <button onClick={reset}
          className="mt-6 px-5 py-2.5 bg-accent-500 hover:bg-accent-600 text-navy-950 font-semibold rounded-lg text-sm transition-colors">
          Try again
        </button>
      </div>
    </main>
  );
}
