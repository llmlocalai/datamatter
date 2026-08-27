import Nav from './Nav';
import Link from 'next/link';

export function PageHeader({ eyebrow, title, lede }: { eyebrow: string; title: React.ReactNode; lede: string }) {
  return (
    <header className="pt-12 pb-8 border-b border-navy-800/60">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-400 mb-3">{eyebrow}</p>
      <h1 className="text-3xl sm:text-4xl font-bold text-navy-50 leading-tight text-balance max-w-3xl">{title}</h1>
      <p className="mt-4 text-navy-300 leading-relaxed max-w-2xl">{lede}</p>
    </header>
  );
}

export function Section({ title, note, children, id }:
  { title: string; note?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="py-10 border-b border-navy-800/40 last:border-0">
      <h2 className="text-xl font-bold text-navy-50 mb-1.5">{title}</h2>
      {note && <p className="text-sm text-navy-400 mb-6 max-w-3xl leading-relaxed">{note}</p>}
      {!note && <div className="mb-6" />}
      {children}
    </section>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col">
      <Nav />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8">{children}</main>
      <footer className="border-t border-navy-800/60 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row gap-4 md:items-center justify-between text-xs text-navy-500">
          <p className="max-w-xl leading-relaxed">
            Built on public USASpending data and a curated DoD financial-management
            knowledge bank. <strong className="text-navy-400 font-medium">No controlled unclassified
            information is present on this site</strong>, and none transits it. Every figure names its
            source and vintage; see <Link href="/sources" className="text-accent-400 hover:underline">Sources</Link> and{' '}
            <Link href="/controls" className="text-accent-400 hover:underline">Controls</Link>.
          </p>
          <p className="shrink-0">© {new Date().getFullYear()} datamatter</p>
        </div>
      </footer>
    </div>
  );
}
