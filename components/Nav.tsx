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
      { href: '/ppbe', label: 'Justification' } ] },
  { label: 'Execution', items: [
      { href: '/execution', label: 'Budget to execution' },
      { href: '/funds-control', label: 'Funds control' },
      { href: '/contracting', label: 'Contracting' } ] },
  { label: 'Oversight', items: [
      { href: '/reconciliation', label: 'Reconciliation' },
      { href: '/audit', label: 'Audit posture' },
      { href: '/congressional', label: 'Congressional' } ] },
  { label: 'Method', items: [
      { href: '/sources', label: 'Sources' },
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
            <div className="w-7 h-7 rounded bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center text-navy-950 font-bold text-[11px]">
              dm
            </div>
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
              <div className="text-[10px] uppercase tracking-wider text-navy-500 font-semibold mb-1">{g.label}</div>
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
