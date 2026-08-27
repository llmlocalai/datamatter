import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-navy-950 flex items-center justify-center px-6">
      <div className="max-w-lg">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-400 mb-3">404</p>
        <h1 className="text-2xl font-bold text-navy-50">No page here</h1>
        <p className="text-navy-300 mt-3 leading-relaxed text-sm">
          Some routes moved when the site was reorganised around the budget lifecycle:{' '}
          <code className="font-mono text-xs text-accent-400">/gao</code> is now{' '}
          <Link href="/audit" className="text-accent-400 hover:underline">/audit</Link>, and{' '}
          <code className="font-mono text-xs text-accent-400">/showcase</code> is now the home page.
        </p>
        <Link href="/"
          className="inline-block mt-6 px-5 py-2.5 bg-accent-500 hover:bg-accent-600 text-navy-950 font-semibold rounded-lg text-sm transition-colors">
          Go to the index
        </Link>
      </div>
    </main>
  );
}
