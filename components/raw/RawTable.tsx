'use client';
import { useMemo, useState } from 'react';

type Cell = string | null;
interface Column { name: string; type: string }

/**
 * One file's sample records, every column. Two layouts of the same values:
 * "As filed" is the file's own shape -- one line per record, columns across, in
 * file order -- and "Field by field" turns it on its side so a 90-column file
 * reads down the page. Nothing is truncated in either: a long description wraps
 * rather than being cut, because a raw-data page that elides a value is not
 * showing the raw data.
 *
 * null (the file holds no value) and "" (the file holds an empty string) are
 * different things in these files and are shown differently.
 */
export default function RawTable({ columns, records, highlight = [] }: {
  columns: Column[]; records: Cell[][]; highlight?: string[];
}) {
  const [layout, setLayout] = useState<'records' | 'fields'>('records');
  const [find, setFind] = useState('');
  const hl = useMemo(() => new Set(highlight), [highlight]);

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return columns.map((c, i) => ({ ...c, i }))
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [columns, find]);

  const cell = (v: Cell) =>
    v === null ? <span className="italic text-navy-500">null</span>
      : v === '' ? <span className="text-navy-500">""</span>
        : <span className="whitespace-pre-wrap break-words">{v}</span>;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="flex gap-1" role="group" aria-label="Layout">
          {([['records', 'As filed'], ['fields', 'Field by field']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setLayout(id)} aria-pressed={layout === id}
              className={`px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                layout === id ? 'bg-accent-500 text-navy-950' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[12px] text-navy-400 max-w-full">
          <span className="uppercase tracking-wider font-semibold text-navy-500">Find a column</span>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="e.g. reimbursable"
            className="bg-navy-900 border border-navy-700 rounded px-2 py-1 text-[13px] text-navy-100 w-48 max-w-full
                       placeholder:text-navy-500 focus:outline-none focus:border-accent-500" />
        </label>
        <span className="text-[12px] text-navy-500 tnum">
          {shown.length === columns.length ? `${columns.length} columns` : `${shown.length} of ${columns.length} columns`}
          {' · '}{records.length} record{records.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="scroll-x rounded-lg border border-navy-800 max-h-[36rem] overflow-y-auto">
        {layout === 'records' ? (
          <table className="text-[12px] font-mono border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-navy-900">
                <th scope="col" className="sticky left-0 z-20 bg-navy-900 px-2 py-2 text-left text-navy-500 font-semibold border-b border-r border-navy-800">#</th>
                {shown.map((c) => (
                  <th key={c.i} scope="col"
                    className={`px-3 py-2 text-left align-bottom border-b border-navy-800 min-w-[8rem] max-w-[22rem] ${
                      hl.has(c.name) ? 'bg-navy-800' : ''}`}>
                    <span className="block text-navy-500 font-normal">{c.i + 1}</span>
                    <span className={`block whitespace-pre-line break-words font-semibold ${hl.has(c.name) ? 'text-accent-400' : 'text-navy-200'}`}>{c.name}</span>
                    {c.type && c.type !== 'cell' && <span className="block text-navy-500 font-normal">{c.type}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r, ri) => (
                <tr key={ri} className="border-t border-navy-800/70 align-top">
                  <th scope="row" className="sticky left-0 bg-navy-950 px-2 py-2 text-left text-navy-500 font-semibold border-r border-navy-800">{ri + 1}</th>
                  {shown.map((c) => (
                    <td key={c.i} className={`px-3 py-2 text-navy-100 min-w-[8rem] max-w-[22rem] ${hl.has(c.name) ? 'bg-navy-800/60' : ''}`}>
                      {cell(r[c.i] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="text-[12px] font-mono border-collapse min-w-full">
            <thead className="sticky top-0 z-10">
              <tr className="bg-navy-900">
                <th scope="col" className="px-2 py-2 text-left text-navy-500 font-semibold border-b border-navy-800">#</th>
                <th scope="col" className="sticky left-0 z-20 bg-navy-900 px-3 py-2 text-left text-navy-400 font-semibold border-b border-r border-navy-800">Column</th>
                <th scope="col" className="px-3 py-2 text-left text-navy-400 font-semibold border-b border-navy-800">Type</th>
                {records.map((_, ri) => (
                  <th key={ri} scope="col" className="px-3 py-2 text-left text-navy-400 font-semibold border-b border-navy-800 min-w-[10rem]">
                    Record {ri + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.i} className={`border-t border-navy-800/70 align-top ${hl.has(c.name) ? 'bg-navy-800/60' : ''}`}>
                  <td className="px-2 py-1.5 text-navy-500 tnum">{c.i + 1}</td>
                  <th scope="row" className={`sticky left-0 px-3 py-1.5 text-left font-semibold border-r border-navy-800 max-w-[16rem] whitespace-pre-line break-words ${
                    hl.has(c.name) ? 'bg-navy-800 text-accent-400' : 'bg-navy-950 text-navy-200'}`}>{c.name}</th>
                  <td className="px-3 py-1.5 text-navy-500 whitespace-nowrap">{c.type === 'cell' ? '' : c.type}</td>
                  {records.map((r, ri) => (
                    <td key={ri} className="px-3 py-1.5 text-navy-100 max-w-[22rem]">{cell(r[c.i] ?? null)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
