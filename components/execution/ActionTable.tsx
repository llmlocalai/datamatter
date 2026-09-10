'use client';

import { useState } from 'react';
import { fmtT } from '@/components/format';

/**
 * The actual contract actions behind the year-end, with the description the
 * contracting officer wrote.
 *
 * The supplies tab exists because it is what a reader arrives having read about.
 * Furniture, food and office equipment are far too small to reach any
 * dollar-ranked list of a $490B year, so a threshold would quietly decide they
 * do not exist. Showing them is not the same as calling them improper, and the
 * note above the tab says so: a barracks furnished in September was very often
 * ordered in March against a construction project that finished when it
 * finished.
 */
export interface ActionRow {
  fiscalYear: number; bucket: string; rankInBucket: number;
  actionDate: string | null; daysToYearEnd: number | null;
  awardIdPiid: string; recipientName: string; recipientState: string;
  subAgency: string; office: string; psc: string; pscDescription: string;
  pscClassLabel: string; pricing: string; competition: string;
  obligation: number; description: string;
}

const BUCKETS: { id: string; label: string; note: string }[] = [
  { id: 'september', label: 'September, largest',
    note: 'The largest contract actions dated in September. Most are multiyear definitisations and exercised options — large because the thing is large, not because the month is ending.' },
  { id: 'last5', label: 'The final five days',
    note: 'Actions dated in the last five days of the fiscal year, which is where a deadline actually lands.' },
  { id: 'september_supplies', label: 'September supplies and furnishings',
    note: 'September actions in the supply groups a year-end story is usually about — furniture, food, household and office equipment, athletic and cleaning supplies. Buying them in September is not itself a finding; these are shown so the question can be asked against the record rather than against a headline.' },
  { id: 'largest', label: 'Largest of the year',
    note: 'The largest actions anywhere in the year, for comparison with the September list beside it.' },
];

export default function ActionTable({ actions, years }: { actions: ActionRow[]; years: number[] }) {
  const available = BUCKETS.filter((b) => actions.some((a) => a.bucket === b.id));
  const [bucket, setBucket] = useState(available[0]?.id ?? 'september');
  const [fy, setFy] = useState<number | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  // A bucket does not exist in every year: the live year has no September at
  // all, so defaulting to the newest year and the first bucket landed on an
  // empty table that read as "no data" rather than "not yet". The year follows
  // the bucket unless the reader has picked one that the bucket has.
  const yearsFor = (b: string) =>
    years.filter((y) => actions.some((a) => a.bucket === b && a.fiscalYear === y));
  const bucketYears = yearsFor(bucket);
  const activeFy = fy !== null && bucketYears.includes(fy) ? fy : bucketYears[0];

  const rows = actions.filter((a) => a.bucket === bucket && a.fiscalYear === activeFy);
  const note = BUCKETS.find((b) => b.id === bucket)?.note;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {available.map((b) => (
          <button key={b.id} onClick={() => { setBucket(b.id); setOpenRow(null); }}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              b.id === bucket ? 'bg-accent-500 text-navy-950' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
            {b.label}
          </button>
        ))}
        <span className="w-px h-5 bg-navy-700 mx-1" />
        {bucketYears.map((y) => (
          <button key={y} onClick={() => setFy(y)}
            className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium tnum transition-colors ${
              y === activeFy ? 'bg-navy-700 text-navy-50' : 'bg-navy-800 text-navy-400 hover:bg-navy-700'}`}>
            FY{y}
          </button>
        ))}
      </div>
      {note && <p className="text-[12px] text-navy-400 mb-3 max-w-3xl leading-relaxed">{note}</p>}

      <div className="scroll-x rounded-lg border border-navy-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-navy-900/70">
              {['Date', 'Obligation', 'Product or service', 'Recipient', 'Awarding office', 'Competition'].map((h, i) => (
                <th key={h} scope="col"
                    className={`px-3 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-navy-400 ${
                      i === 1 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const id = `${a.bucket}-${a.fiscalYear}-${a.rankInBucket}`;
              const open = openRow === id;
              return (
                <tr key={id} onClick={() => setOpenRow(open ? null : id)}
                    className="border-t border-navy-800/70 hover:bg-navy-900/40 cursor-pointer align-top">
                  <td className="px-3 py-2 tnum text-navy-300 whitespace-nowrap">
                    {a.actionDate}
                    {a.daysToYearEnd !== null && a.daysToYearEnd <= 5 && (
                      <span className="block text-[10px] text-amber-400/80">
                        {a.daysToYearEnd === 0 ? 'last day'
                          : `${a.daysToYearEnd} day${a.daysToYearEnd === 1 ? '' : 's'} to year end`}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tnum text-navy-50 font-semibold whitespace-nowrap">
                    {fmtT(a.obligation)}
                  </td>
                  <td className="px-3 py-2 text-navy-200 max-w-[22rem]">
                    <span className="font-mono text-[11px] text-navy-500 mr-1.5">{a.psc}</span>
                    {a.pscDescription}
                    <span className={`block text-[11px] leading-relaxed mt-1 ${
                      open ? 'text-navy-300' : 'text-navy-500 truncate'}`}>
                      {a.description || 'No description published on this action.'}
                    </span>
                    {open && a.awardIdPiid && (
                      <span className="block text-[10px] text-navy-500 mt-1 font-mono">
                        {a.awardIdPiid} · {a.pricing || 'pricing not reported'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-navy-300">
                    {a.recipientName}
                    {a.recipientState && <span className="text-navy-500 text-[11px] ml-1">{a.recipientState}</span>}
                  </td>
                  <td className="px-3 py-2 text-navy-400 text-[12px]">
                    {a.office}
                    <span className="block text-navy-600 text-[11px]">{a.subAgency}</span>
                  </td>
                  <td className="px-3 py-2 text-navy-400 text-[12px]">{a.competition}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-navy-400">
                Nothing held for that combination. An empty result means the filter matched nothing.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-navy-500 mt-3">
        Click a row to see the full description and the award identifier. Actions of $5M and above are
        carried for the largest lists; the supplies list reaches down to $250K, because nothing in
        those groups would otherwise appear at all.
      </p>
    </div>
  );
}
