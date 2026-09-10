'use client';

import { useMemo, useState } from 'react';
import { fmtT, fmtPct, fmtInt } from '@/components/format';

/**
 * The signals, filterable.
 *
 * Every card prints the evidence and the method under the headline, not behind a
 * disclosure. A deviation from a category's own history has many innocent
 * explanations -- a multiyear definitisation, an exercised option, a
 * supplemental -- and a reader who cannot see the years behind the number has no
 * way to reach any of them. The wording throughout is "worth asking about";
 * nothing here observes impropriety and the page must not imply it does.
 */

export interface SignalRow {
  signalKind: string; dimension: string; dimKey: string; dimLabel: string;
  fiscalYear: number | null; metric: number | null; baseline: number | null;
  deviation: number | null; amount: number | null; baselineYears: number;
  direction: string | null; headline: string; evidence: string; method: string;
  severityRank: number;
}

const KIND: Record<string, { label: string; blurb: string; unit: 'pct' | 'money' }> = {
  eoy_deviation: {
    label: 'Year-end share out of pattern',
    blurb: 'A year in which a category put far more, or far less, of its money into September than its own other years.',
    unit: 'pct' },
  spike: {
    label: 'Month out of pattern',
    blurb: 'A month of the year in progress that the same month in prior years does not explain.',
    unit: 'money' },
  pace: {
    label: 'Running ahead or behind',
    blurb: 'The year to date against the median of the same whole months in prior years.',
    unit: 'money' },
  new_activity: {
    label: 'New this year',
    blurb: 'Money in a category that had none in the same window of any prior year held.',
    unit: 'money' },
  eoy_projection: {
    label: 'What September projects to',
    blurb: 'The observed window scaled by how September has related to it before. A projection, not a plan.',
    unit: 'money' },
  eoy_concentration: {
    label: 'How much normally lands in September',
    blurb: 'Not a finding — the shape of the system, published so the deviations above can be read against it.',
    unit: 'pct' },
};

const DIMENSION: Record<string, string> = {
  sub_agency: 'Sub-agency', office: 'Contracting office', psc: 'Product or service code',
  psc_class: 'Supply group', recipient: 'Recipient', pricing: 'Contract pricing',
  competition: 'Extent competed',
};

function Chip({ on, onClick, children, count }: {
  on: boolean; onClick: () => void; children: React.ReactNode; count?: number;
}) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
        on ? 'bg-accent-500 text-navy-950' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
      {children}{count !== undefined && <span className="ml-1.5 opacity-70 tnum">{count}</span>}
    </button>
  );
}

export default function SignalBoard({ signals, totalsByKind, totalsByDimension, shown, total }: {
  signals: SignalRow[];
  /** How many of each kind the load HOLDS, which is not how many are on the page. */
  totalsByKind: Record<string, number>;
  totalsByDimension: Record<string, number>;
  shown: number; total: number;
}) {
  // Ordered as KIND is declared, not as the counts query happened to return
  // them: the descriptive "how much normally lands in September" sorted first
  // alphabetically and became the default tab, so the board opened on the one
  // set of rows that is explicitly not a finding.
  const kinds = useMemo(() => {
    const present = new Set(signals.map((s) => s.signalKind));
    return Object.keys(KIND).filter((k) => present.has(k))
      .map((k) => [k, totalsByKind[k] ?? 0] as [string, number]);
  }, [signals, totalsByKind]);
  const dims = useMemo(() => {
    const present = new Set(signals.map((s) => s.dimension));
    return Object.entries(totalsByDimension)
      .filter(([d]) => present.has(d)).sort((a, b) => b[1] - a[1]);
  }, [signals, totalsByDimension]);

  const [kind, setKind] = useState<string>(kinds[0]?.[0] ?? '');
  const [dim, setDim] = useState<string>('');
  const [showAll, setShowAll] = useState(false);

  const rows = signals
    .filter((s) => (!kind || s.signalKind === kind) && (!dim || s.dimension === dim))
    .slice(0, showAll ? 200 : 12);

  const meta = KIND[kind];

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {kinds.map(([k, n]) => (
          <Chip key={k} on={k === kind} onClick={() => setKind(k)} count={n}>
            {KIND[k]?.label ?? k}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        <Chip on={!dim} onClick={() => setDim('')}>All categories</Chip>
        {dims.map(([d, n]) => (
          <Chip key={d} on={d === dim} onClick={() => setDim(d)} count={n}>
            {DIMENSION[d] ?? d}
          </Chip>
        ))}
      </div>
      {meta && <p className="text-[13px] text-navy-400 mb-2 max-w-3xl">{meta.blurb}</p>}
      <p className="text-[12px] text-navy-500 mb-4">
        The counts are what the load holds. {fmtInt(shown)} of {fmtInt(total)} are carried to this
        page — the most severe of each kind, so that no kind is crowded out by another.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {rows.map((s) => (
          <article key={`${s.signalKind}-${s.dimension}-${s.dimKey}-${s.fiscalYear}-${s.severityRank}`}
            className="glass-card rounded-lg p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <span className="text-[11px] uppercase tracking-wider text-accent-400 font-semibold">
                {DIMENSION[s.dimension] ?? s.dimension}
                {s.fiscalYear ? ` · FY${s.fiscalYear}` : ''}
              </span>
              {s.deviation !== null && (
                <span className={`text-[11px] tnum font-semibold px-1.5 py-0.5 rounded ${
                  Math.abs(s.deviation) >= 99 ? 'bg-navy-800 text-navy-300'
                    : s.direction === 'low' ? 'bg-navy-800 text-sky-300'
                    : 'bg-navy-800 text-amber-300'}`}>
                  {Math.abs(s.deviation) >= 99
                    ? 'beyond its own history'
                    : `${s.deviation > 0 ? '+' : '−'}${Math.abs(s.deviation).toFixed(1)}σ`}
                </span>
              )}
            </div>
            <h4 className="text-navy-50 text-[14px] font-semibold leading-snug">{s.headline}</h4>
            {s.amount !== null && (
              <p className="text-navy-300 text-[13px] mt-1.5 tnum">
                {meta?.unit === 'pct' && s.metric !== null
                  ? `${fmtPct(s.metric)} of the year · ${fmtT(s.amount)}`
                  : fmtT(s.amount)}
              </p>
            )}
            <dl className="mt-3 space-y-1.5 text-[12px]">
              <div>
                <dt className="text-navy-500 uppercase tracking-wide text-[10px]">Evidence</dt>
                <dd className="text-navy-300 tnum leading-relaxed">{s.evidence}</dd>
              </div>
              <div>
                <dt className="text-navy-500 uppercase tracking-wide text-[10px]">Method</dt>
                <dd className="text-navy-400 leading-relaxed">
                  {s.method}. Baseline: {fmtInt(s.baselineYears)} of the category&rsquo;s own years.
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      {!rows.length && (
        <p className="text-navy-400 text-sm py-8 text-center">
          No signal of this kind in this category. An empty result means the filter matched nothing.
        </p>
      )}
      {rows.length >= 12 && !showAll && (
        <button onClick={() => setShowAll(true)}
          className="mt-4 px-4 py-2 rounded-lg bg-navy-800 hover:bg-navy-700 text-navy-200 text-sm">
          Show every signal of this kind
        </button>
      )}
    </div>
  );
}
