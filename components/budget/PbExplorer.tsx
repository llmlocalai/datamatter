'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { fmtT, fmtInt, fmtPct } from '@/components/format';

/**
 * The request, drilled into.
 *
 * The old table listed every line item flat with the Treasury account in the
 * first column, so the 1,138 rows of the P-1 read as one account symbol repeated
 * 1,138 times and the two year columns beside them belonged to different sheets.
 * This one is the exhibit's own hierarchy, expanded a level at a time from the
 * server, with all three fiscal years of the same book on every row.
 *
 * Children are fetched, not filtered client-side: the aggregation rule -- which
 * rows are memo and therefore never counted -- lives in SQL so that a subtotal
 * here and the headline above can never be computed two different ways.
 */

type Dim = 'exhibit' | 'component' | 'account' | 'ba' | 'bsa' | 'bli';

interface Node {
  key: string; label: string; level: number; dim: Dim; path: string[];
  fy2025: number; fy2026: number; fy2027: number;
  discretionary: number; mandatory: number;
  lines: number; hasChildren: boolean; nextDim: Dim | null;
}

interface Leaf {
  bli: string; bliTitle: string; costType: string; costTypeTitle: string;
  lineNumber: string; location: string; account: string; accountTitle: string;
  fy2025: number; fy2026: number; fy2027: number;
  discretionary: number; mandatory: number; quantity: number;
  totalColumn: string; totalBasis: string;
  isMemo: boolean; isOffset: boolean; memoReason: string | null;
}

const DIM_TITLE: Record<Dim, string> = {
  exhibit: 'Exhibit', component: 'Component', account: 'Appropriation',
  ba: 'Budget activity', bsa: 'Sub-activity / activity group', bli: 'Budget line item',
};

const ROOTS: { id: string; dims: Dim[]; label: string; note: string }[] = [
  { id: 'exhibit', dims: ['exhibit', 'component', 'account', 'ba', 'bsa', 'bli'],
    label: 'By exhibit',
    note: 'Appropriation title first — the order the budget is displayed in.' },
  { id: 'component', dims: ['component', 'exhibit', 'account', 'ba', 'bsa', 'bli'],
    label: 'By component',
    note: 'Service first — the order a component reads its own request in.' },
  { id: 'activity', dims: ['exhibit', 'ba', 'bsa', 'bli'],
    label: 'By budget activity',
    note: 'Skips the component, so a budget activity is shown Department-wide.' },
];

const key = (p: string[]) => JSON.stringify(p);

function Delta({ from, to }: { from: number; to: number }) {
  if (!from) return <span className="text-navy-600">—</span>;
  const pct = (to - from) / Math.abs(from) * 100;
  const up = pct >= 0;
  return (
    <span className={`tnum text-[12px] font-medium ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
      {up ? '+' : '−'}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function PbExplorer({ pbYear, requestYear }: { pbYear: number; requestYear: number }) {
  const [rootId, setRootId] = useState(ROOTS[0].id);
  const root = useMemo(() => ROOTS.find((r) => r.id === rootId)!, [rootId]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [nodes, setNodes] = useState<Record<string, { dim: Dim | null; rows: Node[] }>>({});
  const [leaves, setLeaves] = useState<Record<string, Leaf[]>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setApplied(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  // A changed root or search invalidates every cached level, not just the top:
  // the paths themselves mean something different once the dimension order
  // changes, and keeping them would graft one tree's children onto another's.
  useEffect(() => { setNodes({}); setLeaves({}); setOpen(new Set()); }, [rootId, applied]);

  const load = useCallback(async (path: string[]) => {
    const k = key(path);
    setBusy((b) => new Set(b).add(k));
    setError(null);
    try {
      const q = new URLSearchParams({
        pb: String(pbYear), fy: String(requestYear),
        dims: root.dims.join(','), path: JSON.stringify(path),
      });
      if (applied) q.set('q', applied);
      const res = await fetch(`/api/pb/tree?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setNodes((n) => ({ ...n, [k]: { dim: json.dim, rows: json.nodes ?? [] } }));
    } catch (e: any) {
      setError(e?.message ?? 'Could not load that level.');
    } finally {
      setBusy((b) => { const s = new Set(b); s.delete(k); return s; });
    }
  }, [pbYear, requestYear, root, applied]);

  const loadLeaves = useCallback(async (path: string[]) => {
    const k = key(path);
    setBusy((b) => new Set(b).add(`leaf:${k}`));
    try {
      const q = new URLSearchParams({
        pb: String(pbYear), fy: String(requestYear),
        dims: root.dims.join(','), path: JSON.stringify(path),
      });
      const res = await fetch(`/api/pb/lines?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setLeaves((l) => ({ ...l, [k]: json.rows ?? [] }));
    } catch {
      setLeaves((l) => ({ ...l, [k]: [] }));
    } finally {
      setBusy((b) => { const s = new Set(b); s.delete(`leaf:${k}`); return s; });
    }
  }, [pbYear, requestYear, root]);

  useEffect(() => { if (!nodes[key([])]) load([]); }, [nodes, load]);

  const toggle = (n: Node) => {
    const k = key(n.path);
    const next = new Set(open);
    if (next.has(k)) next.delete(k);
    else {
      next.add(k);
      if (n.hasChildren && !nodes[k]) load(n.path);
      if (!n.hasChildren && !leaves[k]) loadLeaves(n.path);
    }
    setOpen(next);
  };

  const loaded = key([]) in nodes;
  const top = nodes[key([])]?.rows ?? [];
  const grand = top.reduce(
    (a, n) => ({ fy2025: a.fy2025 + n.fy2025, fy2026: a.fy2026 + n.fy2026,
                 fy2027: a.fy2027 + n.fy2027, lines: a.lines + n.lines }),
    { fy2025: 0, fy2026: 0, fy2027: 0, lines: 0 });

  const render = (path: string[], depth: number): React.ReactNode => {
    const k = key(path);
    const level = nodes[k];
    if (busy.has(k) && !level) {
      return (
        <tr key={`busy-${k}`}>
          <td colSpan={7} className="px-3 py-3 text-navy-500 text-[13px]"
              style={{ paddingLeft: 12 + depth * 18 }}>Loading…</td>
        </tr>
      );
    }
    if (!level) return null;
    return level.rows.map((n) => {
      const nk = key(n.path);
      const isOpen = open.has(nk);
      const share = grand.fy2027 ? n.fy2027 / grand.fy2027 * 100 : 0;
      return (
        <Fragment key={nk}>
          <tr
              className={`border-t border-navy-800/60 hover:bg-navy-800/30 transition-colors ${
                depth === 0 ? 'bg-navy-900/40' : ''}`}>
            <td className="px-3 py-2" style={{ paddingLeft: 12 + depth * 18 }}>
              <button onClick={() => toggle(n)}
                className="text-left inline-flex items-start gap-2 group"
                aria-expanded={isOpen}>
                <span className={`mt-[3px] text-[10px] w-3 shrink-0 ${
                  isOpen ? 'text-accent-400' : 'text-navy-500'} group-hover:text-accent-400`}>
                  {isOpen ? '▼' : '▶'}
                </span>
                <span>
                  <span className={`${depth === 0 ? 'text-navy-50 font-semibold' : 'text-navy-100'}
                                    group-hover:text-accent-400 transition-colors`}>
                    {n.label}
                  </span>
                  {n.key && n.key !== n.label && (
                    <span className="ml-2 font-mono text-[11px] text-navy-500">{n.key}</span>
                  )}
                  <span className="block text-[11px] text-navy-500 mt-0.5">
                    {DIM_TITLE[n.dim]} · {fmtInt(n.lines)} line-year{n.lines === 1 ? '' : 's'}
                    {n.hasChildren ? '' : ' · leaf'}
                  </span>
                </span>
              </button>
            </td>
            <td className="px-3 py-2 text-right tnum text-navy-400">{fmtT(n.fy2025)}</td>
            <td className="px-3 py-2 text-right tnum text-navy-300">{fmtT(n.fy2026)}</td>
            <td className="px-3 py-2 text-right tnum text-navy-50 font-semibold">{fmtT(n.fy2027)}</td>
            <td className="px-3 py-2 text-right whitespace-nowrap"><Delta from={n.fy2026} to={n.fy2027} /></td>
            <td className="px-3 py-2 text-right tnum text-navy-400">
              {n.mandatory ? fmtT(n.mandatory) : <span className="text-navy-600">—</span>}
            </td>
            <td className="px-3 py-2 text-right tnum text-navy-500">{fmtPct(share, share < 1 ? 2 : 1)}</td>
          </tr>
          {isOpen && n.hasChildren && render(n.path, depth + 1)}
          {isOpen && !n.hasChildren && (
            <LeafRows k={nk} depth={depth + 1} rows={leaves[nk]} busy={busy.has(`leaf:${nk}`)} />
          )}
        </Fragment>
      );
    });
  };

  return (
    <div>
      <div className="flex flex-col lg:flex-row gap-3 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a line item, sub-activity, appropriation or symbol…"
          className="flex-1 bg-navy-900/60 border border-navy-700 rounded-lg px-3 py-2 text-sm
                     text-navy-100 placeholder:text-navy-500 focus:outline-none focus:border-accent-500" />
        <div className="flex gap-1.5 flex-wrap">
          {ROOTS.map((r) => (
            <button key={r.id} onClick={() => setRootId(r.id)} title={r.note}
              className={`px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                r.id === rootId ? 'bg-accent-500 text-navy-950'
                                : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-navy-500 mb-3">{root.note}</p>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-navy-800/50 border-b border-navy-700">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-accent-400">
                  {DIM_TITLE[root.dims[0]]} → {DIM_TITLE[root.dims[root.dims.length - 1]]}
                </th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-accent-400">FY{requestYear - 2} actual</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-accent-400">FY{requestYear - 1} enacted</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-accent-400">FY{requestYear} request</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-accent-400">Δ</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-accent-400">of which mandatory</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-accent-400">Share</th>
              </tr>
            </thead>
            <tbody>
              {error && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-rose-400">{error}</td></tr>
              )}
              {!error && !top.length && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-navy-400">
                  {loaded ? 'Nothing matches that search.' : 'Loading the request…'}
                </td></tr>
              )}
              {render([], 0)}
              {top.length > 0 && (
                <tr className="border-t-2 border-navy-700 bg-navy-900/60">
                  <td className="px-3 py-2.5 text-navy-100 font-semibold">
                    Total of the displayed exhibits
                    <span className="block text-[11px] text-navy-500 font-normal mt-0.5">
                      Counted rows only — memo restatements are excluded and set out below
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tnum text-navy-300">{fmtT(grand.fy2025)}</td>
                  <td className="px-3 py-2.5 text-right tnum text-navy-200">{fmtT(grand.fy2026)}</td>
                  <td className="px-3 py-2.5 text-right tnum text-navy-50 font-bold">{fmtT(grand.fy2027)}</td>
                  <td className="px-3 py-2.5 text-right"><Delta from={grand.fy2026} to={grand.fy2027} /></td>
                  <td /><td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** The rows under a leaf: one per cost type, with memo rows shown and labelled. */
function LeafRows({ k, depth, rows, busy }: {
  k: string; depth: number; rows?: Leaf[]; busy: boolean;
}) {
  if (busy && !rows) {
    return <tr><td colSpan={7} className="px-3 py-2 text-navy-500 text-[13px]"
      style={{ paddingLeft: 12 + depth * 18 }}>Loading rows…</td></tr>;
  }
  if (!rows?.length) return null;
  return (
    <>
      {rows.map((r, i) => (
        <tr key={`${k}-${i}`} className="border-t border-navy-800/40 bg-navy-950/40">
          <td className="px-3 py-1.5 text-[12px]" style={{ paddingLeft: 12 + depth * 18 }}>
            <span className={r.isMemo ? 'text-navy-500 line-through decoration-navy-700' : 'text-navy-300'}>
              {r.costTypeTitle || r.location || r.bliTitle || 'Line total'}
            </span>
            {r.isMemo && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-navy-800 text-navy-400 text-[10px] uppercase tracking-wide">
                memo · not counted
              </span>
            )}
            {r.isOffset && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-navy-800 text-amber-400/80 text-[10px] uppercase tracking-wide">
                offset · counted
              </span>
            )}
            <span className="block text-[10px] text-navy-600 mt-0.5">
              from “{r.totalColumn}” · {r.totalBasis.replace(/_/g, ' ')}
              {r.quantity ? ` · quantity ${fmtInt(r.quantity)}` : ''}
            </span>
          </td>
          <td className="px-3 py-1.5 text-right tnum text-[12px] text-navy-500">{fmtT(r.fy2025)}</td>
          <td className="px-3 py-1.5 text-right tnum text-[12px] text-navy-400">{fmtT(r.fy2026)}</td>
          <td className={`px-3 py-1.5 text-right tnum text-[12px] ${
            r.isMemo ? 'text-navy-500' : 'text-navy-200'}`}>{fmtT(r.fy2027)}</td>
          <td /><td className="px-3 py-1.5 text-right tnum text-[12px] text-navy-500">
            {r.mandatory ? fmtT(r.mandatory) : ''}
          </td><td />
        </tr>
      ))}
    </>
  );
}
