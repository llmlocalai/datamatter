'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

/**
 * Navigation follows the budget lifecycle rather than a list of demos:
 * formulation -> execution -> contracting -> oversight -> how it is built.
 */
const GROUPS: { label: string; items: { href: string; label: string }[] }[] = [
  { label: 'Formulation', items: [
      { href: '/budget', label: 'FY2027 request' },
      { href: '/ppbe', label: 'Justification' },
      { href: '/jbook', label: 'Write a J-book' } ] },
  { label: 'Execution', items: [
      { href: '/execution', label: 'Budget to execution' },
      { href: '/funds-control', label: 'Funds control' },
      { href: '/contracting', label: 'Contracting' },
      { href: '/program', label: 'By program' },
      { href: '/assistance', label: 'Assistance' } ] },
  { label: 'Oversight', items: [
      { href: '/traceability', label: 'Traceability break' },
      { href: '/linkage', label: 'Linkage' },
      { href: '/reconciliation', label: 'Reconciliation' },
      { href: '/audit', label: 'Audit posture' },
      { href: '/congressional', label: 'Congressional' } ] },
  { label: 'Method', items: [
      { href: '/ask', label: 'Ask the corpus' },
      { href: '/sources', label: 'Sources' },
      { href: '/raw-data', label: 'Raw data' },
      { href: '/definitions', label: 'Definitions' },
      { href: '/controls', label: 'Controls' },
      { href: '/regulation', label: 'Regulatory search' } ] },
];

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (h: string) => pathname === h;
  return (
    <nav className="sticky top-0 z-50 bg-navy-950/92 backdrop-blur-md border-b border-navy-800/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            {/* The same geometry the favicon is cut from, so the tab icon and
                the header are one mark rather than two things that resemble
                each other. Drawn rather than set: the site declares Inter but
                ships no webfont, so type here would render differently on every
                visitor's machine and never match the icon at all. */}
            <svg viewBox="0 0 64 64" className="w-7 h-7 shrink-0" role="img"
                 aria-label="datamatter">
              <defs>
                <linearGradient id="dm-mark" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#e8b54a" />
                  <stop offset="1" stopColor="#c08a10" />
                </linearGradient>
              </defs>
              <rect width="64" height="64" rx="13" fill="url(#dm-mark)" />
              <g fill="none" stroke="#0a1929" strokeWidth="5.5" strokeLinejoin="round">
                <circle cx="17.5" cy="36" r="7.6" />
                <path d="M25,15 V46.5" />
                <path d="M35,46.5 V33.15 C35,30.527 37.127,28.4 39.75,28.4 C42.373,28.4 44.5,30.527 44.5,33.15 V46.5" />
                <path d="M44.5,46.5 V33.15 C44.5,30.527 46.627,28.4 49.25,28.4 C51.873,28.4 54,30.527 54,33.15 V46.5" />
              </g>
            </svg>
            <span className="text-navy-100 font-semibold text-sm hidden sm:block">datamatter</span>
          </Link>

          <div className="hidden lg:flex items-center gap-7">
            {GROUPS.map((g) => (
              <div key={g.label} className="relative group">
                <button className="text-navy-300 hover:text-accent-400 text-[13px] font-medium py-4 transition-colors">
                  {g.label}
                </button>
                <div className="absolute left-0 top-full pt-1 hidden group-hover:block group-focus-within:block">
                  <div className="bg-navy-900 border border-navy-700/70 rounded-lg shadow-xl py-1.5 min-w-[13rem]">
                    {g.items.map((i) => (
                      <Link key={i.href} href={i.href}
                        className={`block px-4 py-2 text-[13px] transition-colors ${
                          isActive(i.href) ? 'text-accent-400 bg-navy-800/60' : 'text-navy-300 hover:text-accent-400 hover:bg-navy-800/40'}`}>
                        {i.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => setOpen(!open)}
            aria-expanded={open} aria-label="Toggle navigation"
            className="lg:hidden text-navy-300 hover:text-accent-400 p-2">
            <span className="block w-5 h-px bg-current mb-1.5" />
            <span className="block w-5 h-px bg-current mb-1.5" />
            <span className="block w-5 h-px bg-current" />
          </button>
        </div>
      </div>
      {open && (
        <div className="lg:hidden border-t border-navy-800/60 bg-navy-950 px-4 py-3 space-y-3 max-h-[70vh] overflow-y-auto">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="text-[12px] uppercase tracking-wider text-navy-500 font-semibold mb-1">{g.label}</div>
              <div className="grid grid-cols-2 gap-1">
                {g.items.map((i) => (
                  <Link key={i.href} href={i.href} onClick={() => setOpen(false)}
                    className={`px-2 py-1.5 rounded text-[13px] ${isActive(i.href) ? 'text-accent-400 bg-navy-800/60' : 'text-navy-300'}`}>
                    {i.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}
