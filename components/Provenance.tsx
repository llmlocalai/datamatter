import type { Provenance } from '@/lib/analytics';

/**
 * The citation contract. Every page that shows a figure renders this directly
 * under its heading — source system, extraction path, grain, vintage, and the
 * dataset's stated limitation. A page with numbers and no <ProvenanceBar/> is
 * a defect, which is why the component takes the whole Provenance record
 * rather than a caption string.
 */
export function ProvenanceBar({ p, extra }: { p: Provenance | null; extra?: string }) {
  if (!p) {
    return (
      <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg px-4 py-3 text-sm text-amber-200">
        No current load for this dataset. Run <code className="font-mono text-xs">npm run refresh</code> to
        extract and load it; figures are withheld rather than shown without provenance.
      </div>
    );
  }
  return (
    <div className="border border-navy-700/50 bg-navy-900/40 rounded-lg text-sm">
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-px bg-navy-800/40 rounded-t-lg overflow-hidden">
        {[
          ['Source', p.sourceSystem],
          ['Grain', p.grain],
          ['Vintage', p.vintage],
          ['Rows loaded', p.rowCount.toLocaleString('en-US')],
        ].map(([k, v]) => (
          <div key={k} className="bg-navy-900/70 px-4 py-2.5">
            <dt className="text-[10px] uppercase tracking-wider text-navy-500 font-semibold">{k}</dt>
            <dd className="text-navy-100 text-xs mt-0.5 tnum">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="px-4 py-3 space-y-1.5">
        <p className="text-xs text-navy-400">
          <span className="text-navy-500">Path</span>{' '}
          <code className="font-mono text-[11px] text-accent-400">{p.sourcePath}</code>
          <span className="text-navy-600"> · extracted {p.extractedAt.slice(0, 16).replace('T', ' ')}</span>
          <span className="text-navy-600"> · refresh {p.refreshCadence}</span>
        </p>
        <p className="text-xs text-navy-400">
          <span className="text-navy-500">Limitations</span> {p.limitations}
        </p>
        {extra && <p className="text-xs text-amber-200/80">{extra}</p>}
      </div>
    </div>
  );
}

/** Inline vintage chip for a single figure that sits away from the main bar. */
export function VintageChip({ vintage, source }: { vintage: string; source: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-navy-500">
      <span className="w-1 h-1 rounded-full bg-accent-500/70" />
      {source} · {vintage}
    </span>
  );
}

/** A stated limitation on an individual display. Senior analysts say these out loud. */
export function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-navy-400 leading-relaxed border-l-2 border-navy-700 pl-3 mt-3">
      {children}
    </p>
  );
}
