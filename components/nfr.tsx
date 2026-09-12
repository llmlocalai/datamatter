import Link from 'next/link';

/**
 * Shared marks for /nfr. Server components: nothing here is interactive, and a
 * grid of 250 cells has no business shipping as client JavaScript.
 */

const COVERAGE_COPY: Record<string, { label: string; cls: string; title: string }> = {
  testable: { label: 'testable here', cls: 'bg-[color:var(--status-good)]/12 text-[color:var(--status-good)] border-[color:var(--status-good)]/30',
    title: 'A control on this site already tests an assertion of this kind.' },
  partial: { label: 'partial', cls: 'bg-[color:var(--status-warning)]/12 text-[color:var(--status-warning)] border-[color:var(--status-warning)]/30',
    title: 'The sources here reach part of the relationship, with a named loss.' },
  absent: { label: 'not reachable here', cls: 'bg-navy-800/60 text-navy-400 border-navy-700',
    title: 'No published file on this site carries either side of the relationship.' },
};

export function CoverageChip({ coverage }: { coverage: string }) {
  const c = COVERAGE_COPY[coverage] ?? COVERAGE_COPY.absent;
  return (
    <span title={c.title}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${c.cls}`}>
      {c.label}
    </span>
  );
}

/** reported = the cited document states it; derived = this site read it out. */
export function BasisChip({ basis }: { basis: string }) {
  const reported = basis === 'reported';
  return (
    <span
      title={reported
        ? 'Stated in the cited document.'
        : 'Read out of the cited document by this site. A reader may disagree with it without disputing the document.'}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
        reported
          ? 'bg-accent-500/12 text-accent-400 border-accent-500/30'
          : 'bg-navy-800/60 text-navy-400 border-navy-700'}`}>
      {reported ? 'reported' : 'read'}
    </span>
  );
}

/**
 * Presence of each material weakness on each published roster.
 *
 * A blank column is not a closure. FY2023 states 28 Agency-Wide material
 * weaknesses and refers the roster to an appendix that is not in the released
 * text, so no year is drawn for it at all and the grid says so rather than
 * showing every weakness as absent that year.
 */
export function PersistenceGrid({ years, rows }: {
  years: number[];
  rows: { mwKey: string; label: string; obstacle: string; present: number[]; current: boolean }[];
}) {
  return (
    <div className="scroll-x rounded-lg border border-navy-800">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-navy-900/70">
            <th scope="col" className="px-4 py-2.5 text-left text-[12px] uppercase tracking-wider font-semibold text-navy-400">
              Material weakness
            </th>
            {years.map((y) => (
              <th key={y} scope="col" className="px-2 py-2.5 text-center text-[12px] font-semibold text-navy-400 tnum">
                {String(y).slice(2)}
              </th>
            ))}
            <th scope="col" className="px-4 py-2.5 text-right text-[12px] uppercase tracking-wider font-semibold text-navy-400">
              Years
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.mwKey} className="border-t border-navy-800/70 hover:bg-navy-900/40">
              <td className="px-4 py-2 text-navy-300">
                {r.current
                  ? <Link href={`/nfr/${r.mwKey}`} className="text-navy-100 hover:text-accent-400">{r.label}</Link>
                  : <span className="text-navy-400">{r.label}</span>}
                <span className="block text-[11px] text-navy-600">{r.obstacle}</span>
              </td>
              {years.map((y) => {
                const on = r.present.includes(y);
                return (
                  <td key={y} className="px-2 py-2 text-center">
                    <span
                      title={on ? `On the FY${y} roster` : `Not on the FY${y} roster`}
                      className={`inline-block w-3 h-3 rounded-sm ${
                        on ? 'bg-accent-500/80' : 'bg-navy-800'}`} />
                  </td>
                );
              })}
              <td className="px-4 py-2 text-right tnum text-navy-100">{r.present.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One stage of the remediation chain. */
export function ChainStep({ n, title, kind, children }: {
  n: number; title: string; kind: 'finding' | 'design'; children: React.ReactNode;
}) {
  return (
    <li className="relative pl-10 pb-6 last:pb-0">
      <span className="absolute left-0 top-0 flex items-center justify-center w-7 h-7 rounded-full
                       border border-navy-700 bg-navy-900 text-[12px] font-bold text-navy-300 tnum">
        {n}
      </span>
      <span aria-hidden className="absolute left-[13px] top-8 bottom-0 w-px bg-navy-800" />
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-navy-100">{title}</h3>
        <span
          title={kind === 'finding'
            ? 'Carried from the audit record above, with its citation.'
            : 'A design step. Nothing on this site evidences that it was built or that it works.'}
          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold ${
            kind === 'finding'
              ? 'bg-accent-500/12 text-accent-400 border-accent-500/30'
              : 'bg-navy-800/60 text-navy-400 border-navy-700'}`}>
          {kind === 'finding' ? 'from the record' : 'design'}
        </span>
      </div>
      <div className="mt-1.5 text-sm text-navy-300 leading-relaxed max-w-3xl">{children}</div>
    </li>
  );
}
