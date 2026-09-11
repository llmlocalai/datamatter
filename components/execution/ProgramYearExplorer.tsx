'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtT, fmtPct } from '@/components/format';
import type { Funds, PyCell, PyDim, PyDrill, PyNode, PyOrder, PyYear } from '@/lib/program-year';

/**
 * Execution by program year, drilled into.
 *
 * Three layers, one filter row above all of them:
 *
 *   1. Where each fiscal year's execution comes from -- one bar per fiscal year,
 *      split by how old the money is. Click a segment to keep to that money.
 *   2. The drill-down -- component, appropriation, Treasury account, program
 *      activity, object class -- for the fiscal year and program year chosen,
 *      with each row's obligation rate against its own File A resources.
 *   3. When one program year is chosen, that money across every fiscal year it
 *      executes in: obligated in each year, and what was still unobligated at
 *      the end of it.
 *
 * Every figure is a position as at a submission. The warehouse holds one File B
 * submission per fiscal year, so nothing here is a month-by-month curve and
 * nothing is drawn as one.
 */

type Measure = 'obligations' | 'outlays' | 'undelivered';
type Side = 'direct' | 'reimbursable' | 'all';

const SIDES: { id: Side; label: string; note: string }[] = [
  { id: 'direct', label: 'Direct',
    note: 'The account’s own budget authority. Reimbursable work is excluded, because when the customer is another Department account it is already that account’s direct obligation.' },
  { id: 'reimbursable', label: 'Reimbursable',
    note: 'Work performed for a customer and paid back — most of it in the Defense Working Capital Fund. Never added to direct execution here.' },
  { id: 'all', label: 'Direct + reimbursable',
    note: 'Both together, as File A and the Statement of Budgetary Resources publish them. Counts customer-funded work a second time.' },
];

/** A cell's File B figure for a measure and side. Null split means the load predates it. */
const cellValue = (m: Measure, side: Side, c: PyCell): number => {
  if (side === 'all') return c[m];
  const key = `${m}${side === 'direct' ? 'Direct' : 'Reimbursable'}` as
    'obligationsDirect' | 'outlaysDirect' | 'undeliveredDirect'
    | 'obligationsReimbursable' | 'outlaysReimbursable' | 'undeliveredReimbursable';
  return c[key] ?? 0;
};

const MEASURES: { id: Measure; label: string; noun: string }[] = [
  { id: 'obligations', label: 'Obligated', noun: 'obligations' },
  { id: 'outlays', label: 'Outlaid', noun: 'gross outlays' },
  { id: 'undelivered', label: 'Undelivered orders', noun: 'undelivered orders unpaid' },
];

type Bucket = 'b0' | 'b1' | 'b2' | 'b3' | 'nx';
const BUCKETS: { id: Bucket; label: string; color: string; funds: (fy: number) => Funds }[] = [
  { id: 'b0', label: "The year's own money", color: 'var(--py-0)', funds: () => 'current' },
  { id: 'b1', label: 'One year old', color: 'var(--py-1)', funds: (fy) => String(fy - 1) as Funds },
  { id: 'b2', label: 'Two years old', color: 'var(--py-2)', funds: (fy) => String(fy - 2) as Funds },
  { id: 'b3', label: 'Three or more years old', color: 'var(--py-3)', funds: () => 'old' },
  { id: 'nx', label: 'No-year', color: 'var(--py-noyear)', funds: () => 'noyear' },
];

const DIM_TITLE: Record<PyDim, string> = {
  agency: 'Component', federal: 'Appropriation', account: 'Treasury account',
  activity: 'Program activity', majorClass: 'Object class group', objectClass: 'Object class',
};
const ORDERS: { id: PyOrder; label: string }[] = [
  { id: 'account', label: 'Component → appropriation → account → activity → object class' },
  { id: 'object', label: 'Object class → component → appropriation → account' },
];

/** Below this a rate says nothing but that the denominator is small. */
const RATE_FLOOR = 1e6;
const SHOW_ROWS = 15;

function bucketOf(fy: number, bpoa: number | null): Bucket | 'advance' {
  if (bpoa == null) return 'nx';
  const age = fy - bpoa;
  if (age < 0) return 'advance';
  return age === 0 ? 'b0' : age === 1 ? 'b1' : age === 2 ? 'b2' : 'b3';
}

function fundsText(funds: Funds, fy: number): string {
  if (funds === 'all') return `Every program year executing in FY${fy}`;
  if (funds === 'current') return `FY${fy} money in FY${fy} (current-year funds)`;
  if (funds === 'prior') return `Prior-year money executing in FY${fy}`;
  if (funds === 'old') return `Money three or more years old, executing in FY${fy}`;
  if (funds === 'noyear') return `No-year money executing in FY${fy}`;
  return `FY${funds} money executing in FY${fy}`;
}

const measureOf = (m: Measure, b: { obligations: number; outlays: number; undelivered: number } | null) =>
  b ? b[m] : 0;

export default function ProgramYearExplorer({ years, cells, defaultFy, fileB, fileA, controls }: {
  years: PyYear[]; cells: PyCell[]; defaultFy: number;
  fileB: { vintage: string; extractedAt: string } | null;
  fileA: { vintage: string; extractedAt: string } | null;
  controls: { code: string; failed: number; message: string | null }[];
}) {
  const [fy, setFy] = useState(defaultFy);
  const [funds, setFunds] = useState<Funds>('current');
  const [measure, setMeasure] = useState<Measure>('obligations');
  const [side, setSide] = useState<Side>('direct');
  const [order, setOrder] = useState<PyOrder>('account');
  const [path, setPath] = useState<string[]>([]);
  const [data, setData] = useState<PyDrill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const overviewRef = useRef<HTMLDivElement>(null);

  const yearRow = years.find((y) => y.fiscalYear === fy);

  // ---- fetch the drill level whenever the slice changes -------------------
  useEffect(() => {
    const ctl = new AbortController();
    setBusy(true); setError(null);
    const q = new URLSearchParams({ fy: String(fy), funds, order, side, path: JSON.stringify(path) });
    fetch(`/api/exec/program-year?${q}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j as PyDrill;
      })
      .then((j) => { setData(j); setShowAll(false); })
      .catch((e) => { if (e?.name !== 'AbortError') setError(e?.message ?? 'Could not load that level.'); })
      .finally(() => { if (!ctl.signal.aborted) setBusy(false); });
    return () => ctl.abort();
  }, [fy, funds, order, path, side]);

  // A Treasury account symbol names its own program year, so a path that reaches
  // an account cannot survive a change of year: keep the levels above it.
  const keepAboveAccount = (p: string[]) => {
    const dims = order === 'account'
      ? ['agency', 'federal', 'account', 'activity', 'objectClass']
      : ['majorClass', 'objectClass', 'agency', 'federal', 'account'];
    const cut = dims.indexOf('account');
    return p.slice(0, Math.min(p.length, cut));
  };
  const chooseFy = (y: number) => { setFy(y); setPath((p) => keepAboveAccount(p)); };
  const chooseFunds = (f: Funds) => { setFunds(f); setPath((p) => keepAboveAccount(p)); };
  const chooseOrder = (o: PyOrder) => { setOrder(o); setPath([]); };

  // ---- layer 1: the age of the money, per fiscal year ---------------------
  const overview = useMemo(() => years.map((y) => {
    const parts: Record<Bucket, number> = { b0: 0, b1: 0, b2: 0, b3: 0, nx: 0 };
    let advance = 0;
    for (const c of cells) {
      if (c.fiscalYear !== y.fiscalYear) continue;
      const v = cellValue(measure, side, c);
      const b = bucketOf(y.fiscalYear, c.bpoa);
      if (b === 'advance') advance += v; else parts[b] += v;
    }
    const total = BUCKETS.reduce((s, b) => s + Math.max(0, parts[b.id]), 0);
    return { ...y, parts, total, advance };
  }), [years, cells, measure, side]);
  const overMax = Math.max(1, ...overview.map((o) => o.total));
  const advanceTotal = overview.reduce((s, o) => s + o.advance, 0);

  // The program years that actually carry money in the chosen fiscal year.
  const programYears = useMemo(() => cells
    .filter((c) => c.fiscalYear === fy && c.bpoa != null && (cellValue('obligations', side, c) || c.resources))
    .sort((a, b) => (b.bpoa ?? 0) - (a.bpoa ?? 0)), [cells, fy, side]);

  const selectedBucket: Bucket | null =
    funds === 'current' ? 'b0' : funds === 'old' ? 'b3' : funds === 'noyear' ? 'nx'
      : /^\d{4}$/.test(funds) && fy - Number(funds) === 0 ? 'b0'
      : /^\d{4}$/.test(funds) && fy - Number(funds) === 1 ? 'b1'
      : /^\d{4}$/.test(funds) && fy - Number(funds) === 2 ? 'b2' : null;


  const showTip = (e: React.PointerEvent | React.FocusEvent, lines: string[]) => {
    const box = overviewRef.current?.getBoundingClientRect();
    if (!box) return;
    const pt = 'clientX' in e
      ? { x: e.clientX - box.left, y: e.clientY - box.top }
      : (() => { const r = (e.target as Element).getBoundingClientRect();
                 return { x: r.left - box.left + r.width / 2, y: r.top - box.top }; })();
    setTip({ ...pt, lines });
  };

  // ---- layer 2: the drill level -------------------------------------------
  const nodes = data?.nodes ?? [];
  const visible = showAll ? nodes : nodes.slice(0, SHOW_ROWS);
  const nodeMax = Math.max(1, ...nodes.map((n) => Math.max(0, measureOf(measure, n.b))));
  const levelTotal = nodes.reduce((s, n) => s + measureOf(measure, n.b), 0);
  const ta = data?.totals.a ?? null;
  const tb = data?.totals.b ?? null;
  // The rate follows the side. Direct + reimbursable is File A over File A, as the
  // statement publishes it. Direct is File B direct obligations over File A
  // resources other than spending authority from offsetting collections --
  // File A carries no split, and offsetting collections are the authority that
  // reimbursable work earns. Reimbursable has no File A denominator at all.
  const rateOf = (b: { obligations: number } | null, a: {
    resources: number; offsettingCollections: number; obligations: number } | null): number | null => {
    if (!a) return null;
    if (side === 'all') return a.resources >= RATE_FLOOR ? a.obligations / a.resources * 100 : null;
    if (side === 'reimbursable' || !b) return null;
    const den = a.resources - Math.max(0, a.offsettingCollections);
    return den >= RATE_FLOOR ? b.obligations / den * 100 : null;
  };
  const denomOf = (a: { resources: number; offsettingCollections: number }) =>
    side === 'direct' ? a.resources - Math.max(0, a.offsettingCollections) : a.resources;
  const rate = rateOf(tb, ta);
  const abGap = side === 'all' && ta && tb && ta.obligations
    ? Math.abs(tb.obligations - ta.obligations) / Math.abs(ta.obligations) * 100 : 0;
  const failing = controls.filter((c) => (c.code.startsWith('POA') || c.code.startsWith('DR')) && c.failed > 0);
  const sideWord = side === 'all' ? '' : side === 'direct' ? 'Direct ' : 'Reimbursable ';

  const drillInto = (n: PyNode) => { if (n.hasChildren) setPath(n.path); };

  const nodeMeta = (n: PyNode): string => {
    const bits: string[] = [];
    if (n.key && n.key !== n.label && n.dim !== 'agency' && n.dim !== 'majorClass') bits.push(n.key);
    if (n.dim === 'activity' && n.label === n.key) bits.push('reporting key; no name published');
    if (!n.b) bits.push('resources with no File B line');
    return bits.join(' · ');
  };

  // ---- layer 3: one program year across its life --------------------------
  const life = data?.lifecycle ?? null;
  const lifeMax = life ? Math.max(1, ...life.rows.flatMap((r) => [r.obligations, r.unobligated])) : 1;

  return (
    <div>
      {failing.length > 0 && (
        <div className="alert-warning rounded-lg px-4 py-3 text-sm text-navy-100 mb-4">
          <strong>Program-year or funding-source controls are failing on this load.</strong>{' '}
          {failing.map((c) => `${c.code}: ${c.message ?? `${c.failed} failure(s)`}`).join(' ')}{' '}
          Figures below may be filed under the wrong program year or funding source.
        </div>
      )}

      {/* ---- the one filter row ---------------------------------------- */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 mb-5">
        <fieldset>
          <legend className="text-[12px] uppercase tracking-wider text-navy-500 font-semibold mb-1.5">
            Fiscal year executing
          </legend>
          <div className="flex gap-1 flex-wrap">
            {years.map((y) => (
              <button key={y.fiscalYear} onClick={() => chooseFy(y.fiscalYear)}
                aria-pressed={y.fiscalYear === fy}
                className={`px-2.5 py-1.5 rounded-md text-[13px] font-medium tnum transition-colors ${
                  y.fiscalYear === fy ? 'bg-accent-500 text-navy-950' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
                FY{y.fiscalYear}{y.isPartial ? '*' : ''}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[12px] uppercase tracking-wider text-navy-500 font-semibold mb-1.5">
            Program year (period of availability begins)
          </legend>
          <div className="flex gap-1 flex-wrap items-center">
            {([['current', `FY${fy} money only`], ['prior', 'Prior-year money'],
               ['noyear', 'No-year'], ['all', 'All']] as [Funds, string][]).map(([f, l]) => (
              <button key={f} onClick={() => chooseFunds(f)} aria-pressed={funds === f}
                className={`px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  funds === f ? 'bg-accent-500 text-navy-950' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
                {l}
              </button>
            ))}
            <label className="sr-only" htmlFor="py-select">A specific program year</label>
            <select id="py-select"
              value={/^\d{4}$/.test(funds) ? funds : ''}
              onChange={(e) => e.target.value && chooseFunds(e.target.value as Funds)}
              className={`max-w-full rounded-md text-[13px] px-2 py-1.5 border focus:outline-none focus:border-accent-500 ${
                /^\d{4}$/.test(funds) ? 'bg-accent-500 text-navy-950 border-accent-500 font-medium'
                  : 'bg-navy-900 text-navy-200 border-navy-700'}`}>
              <option value="">Then-year money…</option>
              {programYears.map((c) => (
                <option key={c.bpoa!} value={String(c.bpoa)}>
                  FY{c.bpoa} money · {fmtT(cellValue('obligations', side, c))} {side === 'all' ? '' : `${side} `}obligated in FY{fy}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[12px] uppercase tracking-wider text-navy-500 font-semibold mb-1.5">
            Funding
          </legend>
          <div className="flex gap-1 flex-wrap">
            {SIDES.map((sd) => (
              <button key={sd.id} onClick={() => setSide(sd.id)} aria-pressed={side === sd.id} title={sd.note}
                className={`px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  side === sd.id ? 'bg-accent-500 text-navy-950' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
                {sd.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[12px] uppercase tracking-wider text-navy-500 font-semibold mb-1.5">Measure</legend>
          <div className="flex gap-1">
            {MEASURES.map((m) => (
              <button key={m.id} onClick={() => setMeasure(m.id)} aria-pressed={measure === m.id}
                className={`px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  measure === m.id ? 'bg-navy-600 text-navy-50' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {/* ---- layer 1 ---------------------------------------------------- */}
      <div className="glass-card rounded-xl p-5 mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-navy-100">
            Where each fiscal year&rsquo;s {sideWord.toLowerCase()}{MEASURES.find((m) => m.id === measure)!.noun} come from, by age of the money
          </h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-navy-300" aria-label="Legend">
            {BUCKETS.map((b) => (
              <li key={b.id} className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: b.color }} />
                {b.label}
              </li>
            ))}
          </ul>
        </div>
        <div ref={overviewRef} className="relative" onPointerLeave={() => setTip(null)}
             role="group" aria-label="Execution by fiscal year, split by the age of the money">
          {/* HTML rather than SVG so the labels stay at reading size on a phone:
              a scaled viewBox shrinks its text with the drawing. */}
          <div className="space-y-1.5">
            {overview.map((o) => {
              const active = o.fiscalYear === fy;
              return (
                <div key={o.fiscalYear}
                  className={`flex items-center gap-2 sm:gap-3 rounded-md px-1.5 py-1 ${active ? 'bg-accent-500/10' : ''}`}>
                  <span className={`w-14 shrink-0 text-right text-[12px] tnum ${
                    active ? 'text-accent-400 font-semibold' : 'text-navy-400'}`}>
                    FY{o.fiscalYear}{o.isPartial ? '*' : ''}
                  </span>
                  <span className="flex-1 min-w-0 h-4">
                    <span className="flex h-full gap-[2px]" style={{ width: `${o.total / overMax * 100}%` }}>
                      {BUCKETS.map((b) => {
                        const v = o.parts[b.id];
                        if (v <= 0 || !o.total) return null;
                        const isSel = active && selectedBucket === b.id;
                        const dim = active && selectedBucket != null && !isSel && funds !== 'all' && funds !== 'prior';
                        const lines = [`${fmtT(v)}`, `${b.label} · FY${o.fiscalYear}`,
                          `${fmtPct(v / o.total * 100)} of the year`];
                        const pick = () => { setFy(o.fiscalYear); chooseFunds(b.funds(o.fiscalYear)); };
                        return (
                          <button key={b.id} type="button"
                            aria-label={`${lines[1]}: ${lines[0]}, ${lines[2]}. Keep to this money.`}
                            aria-pressed={isSel}
                            onClick={pick}
                            onPointerMove={(e) => showTip(e, lines)}
                            onFocus={(e) => showTip(e, lines)}
                            onBlur={() => setTip(null)}
                            className="h-full min-w-[3px] rounded-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                            style={{ flexGrow: v, flexBasis: 0, background: b.color, opacity: dim ? 0.35 : 1,
                                     boxShadow: isSel ? '0 0 0 2px var(--chart-surface), 0 0 0 3.5px var(--py-0)' : undefined }} />
                        );
                      })}
                    </span>
                  </span>
                  <span className="w-14 shrink-0 text-right text-[12px] tnum text-navy-200">{fmtT(o.total)}</span>
                </div>
              );
            })}
          </div>
          {tip && (
            <div className="pointer-events-none absolute z-10 rounded-md border border-navy-700 bg-navy-950/95
                            px-3 py-2 text-[12px] shadow-lg"
                 style={{ left: Math.min(tip.x + 12, (overviewRef.current?.clientWidth ?? 600) - 220), top: tip.y + 12 }}>
              <div className="text-navy-50 font-semibold tnum">{tip.lines[0]}</div>
              {tip.lines.slice(1).map((l) => <div key={l} className="text-navy-400">{l}</div>)}
            </div>
          )}
        </div>
        <p className="text-[12px] text-navy-500 mt-2 leading-relaxed">
          Click a segment to keep to that money. Age is the fiscal year executing minus the year the
          money&rsquo;s period of availability begins. * period-to-date
          {yearRow?.isPartial && yearRow.submissionPeriod ? ` (FY${yearRow.fiscalYear} at ${yearRow.submissionPeriod})` : ''}.
          {advanceTotal > 0 && ` ${fmtT(advanceTotal)} appropriated for a later program year than the one executing it is not drawn.`}
          {' '}
          <button onClick={() => setShowTable((s) => !s)} className="text-accent-400 hover:underline">
            {showTable ? 'Hide the table' : 'Show as a table'}
          </button>
        </p>
        {showTable && (
          <div className="scroll-x mt-3">
            <table className="min-w-full text-[12px]">
              <thead>
                <tr className="border-b border-navy-700">
                  <th className="px-2 py-1.5 text-left text-accent-400 font-semibold">Program year</th>
                  {years.map((y) => (
                    <th key={y.fiscalYear} className="px-2 py-1.5 text-right text-accent-400 font-semibold tnum">
                      in FY{y.fiscalYear}{y.isPartial ? '*' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(cells.map((c) => c.bpoa))).sort((a, b) => (b ?? -1) - (a ?? -1)).map((bp) => (
                  <tr key={String(bp)} className="border-b border-navy-800/60">
                    <td className="px-2 py-1 text-navy-200 tnum">{bp == null ? 'No-year' : `FY${bp} money`}</td>
                    {years.map((y) => {
                      const c = cells.find((x) => x.fiscalYear === y.fiscalYear && x.bpoa === bp);
                      const v = c ? cellValue(measure, side, c) : 0;
                      const f: Funds = bp == null ? 'noyear' : bp === y.fiscalYear ? 'current' : (String(bp) as Funds);
                      return (
                        <td key={y.fiscalYear} className="px-2 py-1 text-right tnum">
                          {c && Math.abs(v) >= 5e5 ? (
                            <button onClick={() => { setFy(y.fiscalYear); chooseFunds(f); }}
                              className={`hover:text-accent-400 ${bp === y.fiscalYear ? 'text-navy-50 font-semibold' : 'text-navy-300'}`}>
                              {fmtT(v)}
                            </button>
                          ) : <span className="text-navy-500">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- the selection, stated ------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm mb-3">
        <button onClick={() => setPath([])}
          className={`font-semibold ${path.length ? 'text-accent-400 hover:underline' : 'text-navy-50'}`}>
          {fundsText(funds, fy)}
        </button>
        {(data?.crumbs ?? []).map((c, i) => (
          <span key={`${c.dim}-${c.key}`} className="inline-flex items-center gap-2">
            <span className="text-navy-500" aria-hidden>›</span>
            <button onClick={() => setPath(path.slice(0, i + 1))}
              className={i === path.length - 1 ? 'text-navy-50 font-semibold' : 'text-accent-400 hover:underline'}>
              {c.label}
            </button>
          </span>
        ))}
      </div>

      <div className={`grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5 transition-opacity ${busy ? 'opacity-60' : ''}`}>
        {[
          side === 'direct'
            ? ['Direct resources', ta ? fmtT(denomOf(ta)) : '—',
               'total budgetary resources less spending authority from offsetting collections · File A']
            : ['Available', ta ? fmtT(ta.resources) : '—', 'total budgetary resources, direct and reimbursable · File A'],
          [side === 'direct' ? 'Direct obligation rate' : 'Obligation rate', rate != null ? fmtPct(rate) : '—',
            side === 'reimbursable' ? 'File A carries no reimbursable resources to divide by'
              : !ta ? 'File A has no activity or object class'
              : side === 'direct' ? `${fmtT(tb?.obligations ?? 0)} direct (File B) of direct resources`
              : `${fmtT(ta.obligations)} of available · File A`],
          ['Unobligated', ta ? fmtT(ta.unobligated) : '—', 'direct and reimbursable together; File A does not split it'],
          [`${sideWord}obligated`, tb ? fmtT(tb.obligations) : '—', 'File B'],
          [`${sideWord}outlaid`, tb ? fmtT(tb.outlays) : '—',
            'File B · includes payments on earlier years’ obligations'],
          [`${sideWord}undelivered orders`, tb ? fmtT(tb.undelivered) : '—', 'ordered, not yet received · File B'],
        ].map(([label, value, sub]) => (
          <div key={label} className="glass-card rounded-lg px-4 py-3">
            <div className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">{label}</div>
            <div className="text-xl font-bold text-navy-50 mt-1">{value}</div>
            <div className="text-[12px] text-navy-500 mt-0.5 leading-snug">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ---- layer 2 -------------------------------------------------- */}
        <div className="xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold text-navy-100">
              {data?.dim ? `By ${DIM_TITLE[data.dim].toLowerCase()}` : 'Detail'}
              <span className="text-navy-500 font-normal">
                {' '}· {nodes.length} {nodes.length === 1 ? 'row' : 'rows'} · click a row to open the level beneath
                {data && !data.hasDetail ? ` · FY${fy} is held as account rollups, so the drill stops at the Treasury account` : ''}
              </span>
            </h3>
            <label className="text-[12px] text-navy-400 flex flex-wrap items-center gap-2 max-w-full">
              Break down by
              <select value={order} onChange={(e) => chooseOrder(e.target.value as PyOrder)}
                className="max-w-full bg-navy-900 border border-navy-700 rounded-md px-2 py-1 text-[12px] text-navy-200
                           focus:outline-none focus:border-accent-500">
                {ORDERS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          </div>

          <div className={`glass-card rounded-xl overflow-hidden transition-opacity ${busy ? 'opacity-60' : ''}`}>
            {error && <div className="px-4 py-8 text-center text-[color:var(--status-critical)] text-sm">{error}</div>}
            {!error && data?.unavailable && (
              <div className="px-4 py-8 text-center text-navy-300 text-sm">{data.unavailable}</div>
            )}
            {!error && !data?.unavailable && data && !nodes.length && (
              <div className="px-4 py-8 text-center text-navy-400 text-sm">
                Nothing in this load matches {fundsText(funds, fy).toLowerCase()}
                {path.length ? ' under this selection' : ''}.
              </div>
            )}
            {!data && !error && <div className="px-4 py-8 text-center text-navy-400 text-sm">Loading…</div>}
            {!error && visible.length > 0 && (
              <div role="list">
                <div className="hidden md:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_5.5rem_4rem_8.5rem] gap-3
                                px-4 py-2 border-b border-navy-700 bg-navy-800/40 text-[12px] font-semibold
                                uppercase tracking-wide text-accent-400">
                  <span>{data?.dim ? DIM_TITLE[data.dim] : ''}</span>
                  <span>{MEASURES.find((m) => m.id === measure)!.label}</span>
                  <span className="text-right">Amount</span>
                  <span className="text-right">Share</span>
                  <span className="text-right">{side === 'direct' ? 'Direct of direct resources' : side === 'all' ? 'Obligated of available' : 'Rate'}</span>
                </div>
                {visible.map((n) => {
                  const v = measureOf(measure, n.b);
                  const r = rateOf(n.b, n.a);
                  const Tag = n.hasChildren ? 'button' : 'div';
                  return (
                    <div key={n.path.join('|')} role="listitem">
                    <Tag
                      {...(n.hasChildren ? { onClick: () => drillInto(n), type: 'button' as const } : {})}
                      className={`w-full text-left grid grid-cols-1 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_5.5rem_4rem_8.5rem]
                                  gap-x-3 gap-y-1 items-center px-4 py-2.5 border-b border-navy-800/60
                                  ${n.hasChildren ? 'hover:bg-navy-800/40 cursor-pointer group' : ''}`}>
                      <span className="min-w-0">
                        <span className={`block truncate text-[13px] ${n.hasChildren ? 'text-navy-50 group-hover:text-accent-400' : 'text-navy-200'}`}
                              title={n.label}>
                          {n.hasChildren && <span className="text-navy-500 mr-1.5" aria-hidden>▸</span>}
                          {n.label || 'Not reported'}
                        </span>
                        {nodeMeta(n) && (
                          <span className="block truncate font-mono text-[12px] text-navy-500">{nodeMeta(n)}</span>
                        )}
                      </span>
                      <span className="h-3 rounded-sm bg-navy-800/70 overflow-hidden" aria-hidden>
                        <span className="block h-full rounded-r-[3px]"
                              style={{ width: `${Math.max(0, v) / nodeMax * 100}%`, background: 'var(--series-1)' }} />
                      </span>
                      <span className="text-right tnum text-[13px] text-navy-50 font-semibold">{fmtT(v)}</span>
                      <span className="text-right tnum text-[12px] text-navy-400">
                        {levelTotal ? fmtPct(v / levelTotal * 100) : '—'}
                      </span>
                      <span className="flex items-center justify-end gap-2">
                        {r != null ? (
                          <>
                            <span className="w-12 h-1.5 rounded-full bg-navy-800 overflow-hidden" aria-hidden>
                              <span className="block h-full rounded-full"
                                    style={{ width: `${Math.min(100, Math.max(0, r))}%`, background: 'var(--py-1)' }} />
                            </span>
                            <span className="tnum text-[12px] text-navy-200" title={`${fmtT(n.a!.resources)} total resources; ${fmtT(n.a!.offsettingCollections)} from offsetting collections; ${fmtT(n.a!.unobligated)} unobligated`}>
                              {fmtPct(r)} <span className="text-navy-500">of {fmtT(denomOf(n.a!))}</span>
                            </span>
                          </>
                        ) : <span className="text-[12px] text-navy-500">{side === 'reimbursable' ? 'no File A split' : n.a ? 'too small to rate' : '—'}</span>}
                      </span>
                    </Tag>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {nodes.length > SHOW_ROWS && (
            <button onClick={() => setShowAll((s) => !s)} className="mt-2 text-[13px] text-accent-400 hover:underline">
              {showAll ? `Show the largest ${SHOW_ROWS}` : `Show all ${nodes.length}`}
            </button>
          )}
          {ta && tb && abGap > 0.5 && (
            <p className="text-[12px] text-navy-400 mt-2">
              File B obligations here differ from File A&rsquo;s by {fmtPct(abGap)}. The amounts are File B&rsquo;s;
              the rate is File A&rsquo;s own obligations over its own resources, so it foots to the Statement of
              Budgetary Resources. See TIE-01 on the controls page.
            </p>
          )}
        </div>

        {/* ---- layer 3 -------------------------------------------------- */}
        <div>
          {life && life.rows.length > 0 ? (
            <div className={`glass-card rounded-xl p-4 transition-opacity ${busy ? 'opacity-60' : ''}`}>
              <h3 className="text-sm font-semibold text-navy-100">
                FY{life.programYear} money, fiscal year by fiscal year{side === 'all' ? '' : ` — ${side}`}
              </h3>
              <p className="text-[12px] text-navy-500 mt-0.5 mb-3 leading-snug">
                What was obligated in each year it executes in, and what was still unobligated at the end of it
                {data?.crumbs.length ? ` — ${data.crumbs.filter((c) => ['agency', 'federal', 'account'].includes(c.dim)).map((c) => c.label).join(' › ') || 'Department'}` : ''}.
              </p>
              <ul className="flex gap-4 text-[12px] text-navy-300 mb-2" aria-label="Legend">
                <li className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'var(--series-1)' }} />Obligated in the year
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'var(--py-noyear)' }} />Unobligated at its end
                </li>
              </ul>
              {(() => {
                const W = 360, H = 200, L = 8, R = 8, T = 22, B = 34;
                const n = life.rows.length;
                const slot = (W - L - R) / Math.max(n, 1);
                const bw = Math.min(24, slot / 2 - 6);
                const yv = (v: number) => T + (1 - Math.max(0, v) / lifeMax) * (H - T - B);
                return (
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
                       aria-label={`FY${life.programYear} money obligated and unobligated by fiscal year`}>
                    <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--grid-line)" strokeWidth={1} />
                    {life.rows.map((r, i) => {
                      const cx = L + slot * i + slot / 2;
                      return (
                        <g key={r.fiscalYear}>
                          <rect x={cx - bw - 1} y={yv(r.obligations)} width={bw}
                                height={Math.max(0, H - B - yv(r.obligations))} rx={3} fill="var(--series-1)">
                            <title>{`FY${r.fiscalYear}: ${fmtT(r.obligations)} obligated`}</title>
                          </rect>
                          <rect x={cx + 1} y={yv(r.unobligated)} width={bw}
                                height={Math.max(0, H - B - yv(r.unobligated))} rx={3} fill="var(--py-noyear)">
                            <title>{`FY${r.fiscalYear}: ${fmtT(r.unobligated)} unobligated at the end of the submission`}</title>
                          </rect>
                          {slot >= 60 && (
                            <text x={cx} y={Math.min(yv(r.obligations), yv(r.unobligated)) - 6} textAnchor="middle"
                                  className="fill-navy-200 text-[12px] tnum">{fmtT(r.obligations)}</text>
                          )}
                          <text x={cx} y={H - B + 15} textAnchor="middle"
                                className={`text-[12px] tnum ${r.fiscalYear === fy ? 'fill-accent-400 font-semibold' : 'fill-navy-400'}`}>
                            FY{r.fiscalYear}
                          </text>
                          <text x={cx} y={H - B + 28} textAnchor="middle" className="fill-navy-500 text-[12px]">
                            {r.submissionPeriod && !r.submissionPeriod.endsWith('P12') ? `to ${r.submissionPeriod.slice(-3)}` : 'full year'}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                );
              })()}
              <div className="scroll-x mt-2">
                <table className="min-w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-navy-700 text-accent-400">
                      <th className="py-1 pr-2 text-left font-semibold">In</th>
                      <th className="py-1 px-1 text-right font-semibold">{side === 'direct' ? 'Direct res.' : 'Available'}</th>
                      <th className="py-1 px-1 text-right font-semibold">{side === 'all' ? 'Obligated' : side === 'direct' ? 'Direct obl.' : 'Reimb. obl.'}</th>
                      <th className="py-1 px-1 text-right font-semibold">Unobligated</th>
                      <th className="py-1 pl-1 text-right font-semibold">Outlaid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {life.rows.map((r) => (
                      <tr key={r.fiscalYear} className="border-b border-navy-800/60">
                        <td className="py-1 pr-2 text-navy-200 tnum">FY{r.fiscalYear}</td>
                        <td className="py-1 px-1 text-right text-navy-300 tnum">{fmtT(denomOf(r))}</td>
                        <td className="py-1 px-1 text-right text-navy-50 tnum">{fmtT(r.obligations)}</td>
                        <td className="py-1 px-1 text-right text-navy-300 tnum">{fmtT(r.unobligated)}</td>
                        <td className="py-1 pl-1 text-right text-navy-300 tnum">{fmtT(r.outlays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[12px] text-navy-500 mt-2 leading-snug">
                A later year&rsquo;s &ldquo;available&rdquo; is the balance carried in plus recoveries, not new money, so
                the rows do not add. For annual money every year after the first is the expired phase: the
                balance can take adjustments to existing obligations but no new ones. Unobligated is File A&rsquo;s,
                direct and reimbursable together{side === 'direct' ? '; direct resources exclude offsetting collections but a carried-in balance cannot be split' : ''}.
                {life.accountScoped ? ' Program activity and object class are not carried across years, so this follows the account above them.' : ''}
                {life.rows[0]?.fiscalYear > life.programYear ? ` The warehouse starts at FY${life.rows[0].fiscalYear}; the program year's earlier years are not held.` : ''}
              </p>
            </div>
          ) : (
            <div className="glass-card rounded-xl p-4 text-[13px] text-navy-400 leading-relaxed">
              <h3 className="text-sm font-semibold text-navy-100 mb-1">One program year across its life</h3>
              Choose <strong className="text-navy-200">FY{fy} money only</strong> or a then-year from the list
              above to follow that money through every fiscal year it executes in: obligated in each, and what
              was left unobligated at the end of each.
            </div>
          )}
        </div>
      </div>

      <p className="text-[12px] text-navy-500 mt-5 leading-relaxed">
        File B {yearRow?.submissionPeriod ? `${yearRow.submissionPeriod} ` : ''}· loaded {fileB?.extractedAt ?? '—'}
        {' '}(vintage {fileB?.vintage ?? '—'}) · File A accounts · loaded {fileA?.extractedAt ?? '—'} (vintage {fileA?.vintage ?? '—'})
        {' '}· {controls.filter((c) => c.code.startsWith('POA') || c.code.startsWith('DR')).map((c) => `${c.code} ${c.failed ? 'FAILING' : 'passing'}`).join(' · ')}
        {' '}· {SIDES.find((sd) => sd.id === side)!.note}
      </p>
    </div>
  );
}
