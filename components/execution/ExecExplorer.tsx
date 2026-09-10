'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { fmtT, fmtPct, fmtInt } from '@/components/format';

/**
 * File B, drilled into.
 *
 * The columns are the pipeline, not just the total: an obligation is a binding
 * reservation, and where it sits -- ordered and not yet received, received and
 * not yet paid, or paid -- is what separates an account that is behind from one
 * that is simply buying something that takes a year to arrive. Rates are shown
 * beside the amounts because a $2B account and a $2M account are unreadable in
 * the same column otherwise.
 */

type Dim = 'agency' | 'function' | 'subfunction' | 'federal' | 'account'
         | 'fundLife' | 'majorClass' | 'objectClass' | 'activity' | 'source' | 'defc';

interface Node {
  key: string; label: string; dim: Dim; level: number; path: string[];
  obligations: number; undeliveredUnpaid: number; deliveredUnpaid: number;
  grossOutlays: number; deobligations: number;
  upwardAdjustments: number; downwardAdjustments: number;
  rows: number; hasChildren: boolean;
}

const DIM_TITLE: Record<Dim, string> = {
  agency: 'Component', function: 'Budget function', subfunction: 'Budget sub-function',
  federal: 'Federal account', account: 'Treasury account', fundLife: 'Period of availability',
  majorClass: 'Object class group', objectClass: 'Object class', activity: 'Program activity',
  source: 'Direct or reimbursable', defc: 'Emergency fund code',
};

const VIEWS: { id: string; label: string; dims: Dim[]; note: string }[] = [
  { id: 'account', label: 'By account',
    dims: ['agency', 'function', 'account', 'majorClass', 'objectClass', 'activity'],
    note: 'Component, budget function, Treasury account, then what the money was spent on.' },
  { id: 'object', label: 'By object class',
    dims: ['majorClass', 'objectClass', 'agency', 'account', 'activity'],
    note: 'What kind of thing was bought first — the level at which contract spending separates from payroll.' },
  { id: 'life', label: 'By period of availability',
    dims: ['fundLife', 'agency', 'account', 'majorClass', 'objectClass'],
    note: 'Annual authority expires on 30 September; multi-year and no-year authority does not. This is the split that matters at the year end.' },
  { id: 'source', label: 'Direct and reimbursable',
    dims: ['source', 'agency', 'account', 'majorClass', 'objectClass'],
    note: 'Direct appropriations against work done for someone else and billed back.' },
];

const SOURCE_LABEL: Record<string, string> = { D: 'Direct', R: 'Reimbursable' };
const key = (p: string[]) => JSON.stringify(p);

export default function ExecExplorer({ fiscalYear, years, periodNote }: {
  fiscalYear: number; years: number[]; periodNote: string;
}) {
  const [fy, setFy] = useState(fiscalYear);
  const [viewId, setViewId] = useState(VIEWS[0].id);
  const view = useMemo(() => VIEWS.find((v) => v.id === viewId)!, [viewId]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<Record<string, Node[]>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setApplied(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setNodes({}); setOpen(new Set()); }, [viewId, applied, fy]);

  const load = useCallback(async (path: string[]) => {
    const k = key(path);
    setBusy((b) => new Set(b).add(k));
    setError(null);
    try {
      const q = new URLSearchParams({
        fy: String(fy), dims: view.dims.join(','), path: JSON.stringify(path),
      });
      if (applied) q.set('q', applied);
      const res = await fetch(`/api/exec/tree?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setNodes((n) => ({ ...n, [k]: json.nodes ?? [] }));
    } catch (e: any) {
      setError(e?.message ?? 'Could not load that level.');
    } finally {
      setBusy((b) => { const s = new Set(b); s.delete(k); return s; });
    }
  }, [fy, view, applied]);

  useEffect(() => { if (!nodes[key([])]) load([]); }, [nodes, load]);

  const toggle = (n: Node) => {
    const k = key(n.path);
    const next = new Set(open);
    if (next.has(k)) next.delete(k);
    else { next.add(k); if (n.hasChildren && !nodes[k]) load(n.path); }
    setOpen(next);
  };

  const loaded = key([]) in nodes;
  const top = nodes[key([])] ?? [];
  const grand = top.reduce((s, n) => s + n.obligations, 0);

  const label = (n: Node) =>
    n.dim === 'source' ? (SOURCE_LABEL[n.key] ?? n.label)
      : n.key || 'Not reported';

  const render = (path: string[], depth: number): React.ReactNode => {
    const k = key(path);
    const rows = nodes[k];
    if (busy.has(k) && !rows) {
      return <tr key={`b-${k}`}><td colSpan={7} className="px-3 py-3 text-navy-500 text-[13px]"
        style={{ paddingLeft: 12 + depth * 18 }}>Loading…</td></tr>;
    }
    if (!rows) return null;
    return rows.map((n) => {
      const nk = key(n.path);
      const isOpen = open.has(nk);
      const outlayRate = n.obligations ? n.grossOutlays / n.obligations * 100 : 0;
      const pipeline = n.obligations ? n.undeliveredUnpaid / n.obligations * 100 : 0;
      return (
        <Fragment key={nk}>
          <tr className={`border-t border-navy-800/60 hover:bg-navy-800/30 transition-colors ${
            depth === 0 ? 'bg-navy-900/40' : ''}`}>
            <td className="px-3 py-2" style={{ paddingLeft: 12 + depth * 18 }}>
              <button onClick={() => toggle(n)} disabled={!n.hasChildren}
                className="text-left inline-flex items-start gap-2 group disabled:cursor-default"
                aria-expanded={isOpen}>
                <span className={`mt-[3px] text-[10px] w-3 shrink-0 ${
                  n.hasChildren ? (isOpen ? 'text-accent-400' : 'text-navy-500') : 'text-navy-800'}`}>
                  {n.hasChildren ? (isOpen ? '▼' : '▶') : '·'}
                </span>
                <span>
                  <span className={`${depth === 0 ? 'text-navy-50 font-semibold' : 'text-navy-100'}
                                    ${n.hasChildren ? 'group-hover:text-accent-400' : ''} transition-colors`}>
                    {n.dim === 'account' || n.dim === 'objectClass' || n.dim === 'activity'
                      ? (n.label !== n.key ? n.label : label(n)) : label(n)}
                  </span>
                  {(n.dim === 'account' || n.dim === 'objectClass' || n.dim === 'activity' || n.dim === 'federal')
                    && n.key && n.key !== n.label && (
                    <span className="ml-2 font-mono text-[11px] text-navy-500">{n.key}</span>
                  )}
                  <span className="block text-[11px] text-navy-500 mt-0.5">
                    {DIM_TITLE[n.dim]} · {fmtInt(n.rows)} row{n.rows === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
            </td>
            <td className="px-3 py-2 text-right tnum text-navy-50 font-semibold">{fmtT(n.obligations)}</td>
            <td className="px-3 py-2 text-right tnum text-navy-300">{fmtT(n.undeliveredUnpaid)}</td>
            <td className="px-3 py-2 text-right tnum text-navy-300">{fmtT(n.deliveredUnpaid)}</td>
            <td className="px-3 py-2 text-right tnum text-navy-300">{fmtT(n.grossOutlays)}</td>
            <td className="px-3 py-2 text-right tnum text-navy-400">{fmtPct(outlayRate)}</td>
            <td className="px-3 py-2 text-right tnum text-navy-500">
              {fmtPct(grand ? n.obligations / grand * 100 : 0, 2)}
            </td>
          </tr>
          {isOpen && n.hasChildren && render(n.path, depth + 1)}
        </Fragment>
      );
    });
  };

  return (
    <div>
      <div className="flex flex-col lg:flex-row gap-3 mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search an account, object class or program activity…"
          className="flex-1 bg-navy-900/60 border border-navy-700 rounded-lg px-3 py-2 text-sm
                     text-navy-100 placeholder:text-navy-500 focus:outline-none focus:border-accent-500" />
        <div className="flex gap-1.5 flex-wrap">
          {years.map((y) => (
            <button key={y} onClick={() => setFy(y)}
              className={`px-2.5 py-2 rounded-lg text-[13px] font-medium tnum transition-colors ${
                y === fy ? 'bg-navy-700 text-navy-50' : 'bg-navy-800 text-navy-400 hover:bg-navy-700'}`}>
              FY{y}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-1.5 flex-wrap mb-2">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setViewId(v.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              v.id === viewId ? 'bg-accent-500 text-navy-950' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
            {v.label}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-navy-500 mb-3">{view.note} {fy === fiscalYear ? periodNote : ''}</p>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-navy-800/50 border-b border-navy-700">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-accent-400">
                  {DIM_TITLE[view.dims[0]]} → {DIM_TITLE[view.dims[view.dims.length - 1]]}
                </th>
                {['Obligations', 'Undelivered, unpaid', 'Delivered, unpaid', 'Gross outlays', 'Outlay rate', 'Share'].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-accent-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {error && <tr><td colSpan={7} className="px-3 py-8 text-center text-rose-400">{error}</td></tr>}
              {!error && !top.length && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-navy-400">
                  {loaded ? 'Nothing matches that search.' : 'Loading execution detail…'}
                </td></tr>
              )}
              {render([], 0)}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-navy-500 mt-3">
        Undelivered orders are goods and services ordered and not yet received; delivered orders are
        received and not yet paid. A high undelivered balance is a pipeline measure, not a performance
        measure — multi-year procurement and construction accounts carry large ones by design.
      </p>
    </div>
  );
}
